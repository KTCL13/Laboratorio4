require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const axios = require('axios');
const { Client } = require('ssh2');


// Configuración inicial
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*', 
    methods: ['GET', 'POST'], 
    allowedHeaders: ['Content-Type', 'Authorization']
  },
});

app.use(cors());
app.use(express.json());

// Puerto del servidor
const port = 9000;

// Almacén de nodos
const nodes = [];
const nodesInformation = []

// Configuración SSH
const sshConfig = {
  host: process.env.SSH_HOST,
  port: 22,
  username: process.env.SSH_USERNAME,
  password: process.env.SSH_PASSWORD,
};

// Validación de variables de entorno
if (!sshConfig.host || !sshConfig.username || !sshConfig.password) {
  console.error('Error: Faltan variables de entorno para SSH.');
  process.exit(1);
}

// Variables globales
let leader = null;
let portsData = { hostPort: 3000, containerPort: 3000 };

// --- Endpoints ---

// Registro de un nuevo nodo
app.post('/register', (req, res) => {
  const node  = req.body;
  console.log (node)
  nodes.push(node);
  console.log(`Nodo registrado: ${node.IDNode}`);
  io.emit('updateNodes', nodes); // Enviar actualización de nodos al frontend
  res.status(200).send({ message: 'Nodo registrado correctamente.' });
});

// Obtener nodos
app.get('/nodes', (req, res) => {
  console.log('Obteniendo información de los nodos.');
  res.status(200).send({ nodes });
});

// Crear un nodo mediante Docker
app.post('/run-docker', (req, res) => {
    console.log("/run-docker: iniciando una nueva instancia")
    const {IDnode} = req.body
    
    if (!IDnode) {
        return res.status(400).send("IDnode es obligatorio.");
    }
    
    if (isNaN(IDnode)) {
        return res.status(400).send("IDnode debe ser un número.");
    }

  if (nodes.some(n => n.IDnode === IDnode)) {
    return res.status(409).send({ error: 'Nodo duplicado.' });
  }

  runContainer(IDnode, (err, result) => {
    if (err) {
      console.error('Error al crear contenedor:', err.message);
      return res.status(500).send({ error: `Error: ${err.message}` });
    }

    nodes.push({ IDnode });
    console.log(`Contenedor creado: ${IDnode}`);
    res.status(201).send({ message: `Contenedor creado: ${IDnode}` });
  });
});

app.get('/leader', (req, res) => {
  if (leader === null) {
    console.log('El líder aún no ha sido asignado');
    return res.status(204).send('No leader assigned'); // 204: Sin contenido
  }
  console.log('Enviando líder:', leader);
  res.status(200).send(leader);
});


app.get('/nodes', (req, res) => {
  console.log('Obteniendo información de los nodos.');
  res.status(200).send({ nodes });
});


app.post('/stop-container', (req, res) => {
  console.log('/stop-container');
  const {IDnode} = req.body
  console.log(req.body)

    if (!IDnode) {
        return res.status(400).send("IDnode es obligatorio.");
    }
    
    if (isNaN(IDnode)) {
        return res.status(400).send("IDnode debe ser un número.");
    }

    const node = nodes.find(n => n.IDNode === IDnode);
    console.log(node)

  stopContainerById(node.id, (err, result) => { 
    if (err) {
      console.error('Error al detener contenedor:', err.message);
      return res.status(500).send({ error: `Error: ${err.message}` });
    }
    console.log(`Contenedor detenido: ${node.id}`);
    res.status(200).send({ message: `Contenedor ${node.id} detenido exitosamente.` });
  });
});

// --- Funciones SSH y Docker ---

function stopContainerById(containerId, callback) {
  const command = `docker stop ${containerId}`;
  executeSSHCommand(command, callback);
}

function runContainer(IDnode, callback) {
  const directory = process.env.DOCKER_DIRECTORY;

  if (!directory || !process.env.DISCOVERY_SERVER) {
    return callback(new Error('Faltan variables de entorno para Docker.'));
  }

  portsData.hostPort += 1;
  portsData.containerPort += 1;

  const hostPort = portsData.hostPort;
  const containerPort = portsData.containerPort;
  const discoveryServer = process.env.DISCOVERY_SERVER;
  const ipAddress = process.env.SSH_HOST;
  const uniqueContainerName = `my-node-app-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
  const command = `
    cd ${directory} && \
    docker build -t my-node-app . && \
    docker run -d --rm --name ${uniqueContainerName} \
    -e IDNODE=${IDnode} \
    -e LEADER=${leader} \
    -e DIS_SERVERIP_PORT=${discoveryServer} \
    -e IP_ADDRESS=${ipAddress} \
    -e CONTAINER_NAME=${uniqueContainerName} \
    -e HOST_PORT=${hostPort} \
    -e CONTAINER_PORT=${containerPort} \
    -p ${hostPort}:${containerPort} my-node-app
  `;
  executeSSHCommand(command, callback);
}

function executeSSHCommand(command, callback) {
  const conn = new Client();

  conn.on('ready', () => {
    console.log(command)
    conn.exec(command, (err, stream) => {
      if (err) {
        conn.end();
        return callback(err);
      }

      let outputData = '';
      stream.on('data', (chunk) => {
        outputData += chunk;
      });
      stream.stderr.on('data', (chunk) => {
        console.error(`STDERR: ${chunk}`);
      });
      stream.on('close', () => {
        conn.end();
        callback(null, outputData.trim());
      });
    });
  }).on('error', (err) => {
    callback(err);
  }).connect(sshConfig);
}

// --- WebSocket para comunicación con nodos ---

io.on('connection', (socket) => {
  console.log('Nueva conexión WebSocket establecida.');
  io.emit('update',nodesInformation)

  // Actualización de información de nodos
  socket.on('update', (serverProperties) => {
    const { idNode, healthCheckInterval, logs, leaderStatus } = serverProperties;
    const node = nodesInformation.find(n => n.idNode === idNode);
    if (node) {
       node.logs=logs
       node.leaderStatus=leaderStatus
    } else {
      nodesInformation.push({ idNode, healthCheckInterval, logs, leaderStatus })
    }
    io.emit('update',nodesInformation)
  });

  socket.on('election', (idElection) => {
    io.emit('election',idElection)
  });

  socket.on('newLeader', (data) => {
    console.log(`Nuevo líder: ${data}`);
    leader = data;
  });

  socket.on('disconnect', () => {
    console.log('Conexión WebSocket cerrada.');
  });
});


// --- Inicializar servidor ---
server.listen(port, () => {
  console.log(`Servidor monitor corriendo en el puerto: ${port}`);
});