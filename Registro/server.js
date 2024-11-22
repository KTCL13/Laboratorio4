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
    origin: '*', // Permite conexiones desde cualquier origen
    methods: ['GET', 'POST'], // Métodos permitidos
  },
});

app.use(cors());
app.use(express.json());

// Puerto del servidor
const port = 9000;

// Almacenamiento en memoria para nodos
const nodes = [];
const nodesInformation = {}

// Configuración SSH
const sshConfig = {
  host: process.env.SSH_HOST,
  port: 22,
  username: process.env.SSH_USERNAME,
  password: process.env.SSH_PASSWORD,
};

let leader= null;

let portsData = { hostPort: 3000, containerPort: 3000 };

// --- Endpoints ---

// Registro de un nuevo nodo
app.post('/register', async (req, res) => {
    console.log('Nuevo servidor:', req.body);
    const node = req.body;
    nodes.push(node);
    console.log(`Nodo registrado: ${node.IDNode}`);
    io.emit('updateNodes', nodes );
    res.status(200).send('ok');
  });




// Endpoint para crear un nuevo nodo mediante Docker
app.post('/run-docker', (req, res) => {
    console.log("/run-docker: iniciando una nueva instancia")
    const {IDnode} = req.body
    
    if (!IDnode) {
        return res.status(400).send("IDnode es obligatorio.");
    }
    
    if (isNaN(IDnode)) {
        return res.status(400).send("IDnode debe ser un número.");
    }

  if (!nodes.some(n => n.IDnode === IDnode)) {
   
    runContainer(IDnode, (err, result) => {
      if (err) {
        console.error('Error al crear contenedor:', err.message);
        return res.status(500).send({ error: `Error: ${err.message}` });
      }
      console.log(`Contenedor creado: ${result}`);
      res.status(201).send({ message: `Contenedor creado: ${result}` });
    });
   
  } else {
    console.log('Nodo duplicado.');
    res.status(409).send({ error: 'Nodo duplicado.' });
  }

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
  console.log(new Date(), 'Creando servidor');
  const directory = process.env.DOCKER_DIRECTORY;
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
    docker run --rm --name ${uniqueContainerName} \
    -e IDNODE=${IDnode} \
    -e LEADER=${leader} \
    -e CONTAINER_NAME=${uniqueContainerName} \
    -e HOST_PORT=${hostPort} \
    -e CONTAINER_PORT=${containerPort} \
    -e DIS_SERVERIP_PORT=${discoveryServer} \
    -e IP_ADDRESS=${ipAddress} \
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
  }).connect(sshConfig);
}

// --- WebSocket para comunicación con nodos ---

io.on('connection', (socket) => {
  console.log('Nueva conexión WebSocket establecida.');

  // Actualización de información de nodos
  socket.on('update', (serverProperties) => {
    const { idNode, healthCheckInterval, logs, leaderStatus } = serverProperties;

    // Encuentra el nodo correspondiente en nodes
    const node = nodes.find(n => n.IDNode === idNode);

    if (node) {
      // Actualiza el nodo con la información recibida
      Object.assign(node, {
        healthCheckInterval,
        logs,
        leaderStatus,
        status: 'active', // Establece un estado por defecto al recibir actualización
      });
    } else {
      console.warn(`Nodo con IDNode ${idNode} no encontrado en nodes.`);
    }
  });

  socket.on('newLeader', (data) => {
    console.log(`Nuevo líder: ${data}`);
    leader = data;

    // Actualiza el estado de líder en todos los nodos
    nodes.forEach(node => {
      node.leaderStatus = node.IDNode === leader;
    });
  });

  socket.on('disconnect', () => {
    console.log('Conexión WebSocket cerrada.');
  });
});

// --- Emisión periódica de nodos unificados ---
setInterval(() => {
  const enrichedNodes = nodes.map(node => ({
    idNode: node.IDNode,
    ipAddress: node.ipAddress,
    id: node.id,
    healthCheckInterval: node.healthCheckInterval || 0,
    logs: node.logs || [],
    leaderStatus: node.leaderStatus || false,
    status: node.status || 'unknown',
  }));

  io.emit('update', enrichedNodes);
}, 1000);


// --- Inicializar servidor ---
server.listen(port, () => {
  console.log(`Monitor corriendo en el puerto: ${port}`);
});