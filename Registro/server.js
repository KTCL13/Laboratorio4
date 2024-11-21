const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const axios = require('axios');
const { Client } = require('ssh2');
const { io: clientIo } = require('socket.io-client');

// Configuración inicial
const app = express();
const server = http.createServer(app);
const io = new Server(server);

const updateSocket = clientIo('http://localhost:3000'); // Cambiado nombre para evitar confusiones

app.use(cors());
app.use(express.json());

// Puerto del servidor
const port = 9000;

// Almacén de nodos
const nodes = [];
const nodesInformation = {}; // Cambiado a un objeto que se actualizará correctamente

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
  const { IDnode } = req.body;

  if (!IDnode) {
    return res.status(400).send({ error: 'El campo IDnode es obligatorio.' });
  }

  if (nodes.some(n => n.IDnode === IDnode)) {
    return res.status(409).send({ error: 'Nodo duplicado.' });
  }

  nodes.push({ IDnode });
  console.log(`Nodo registrado: ${IDnode}`);
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
  const { IDnode } = req.body;

  if (!IDnode) {
    return res.status(400).send({ error: 'El campo IDnode es obligatorio.' });
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
    console.log(`Contenedor creado: ${result}`);
    res.status(201).send({ message: `Contenedor creado: ${result}` });
  });
});

// Detener un nodo aleatorio
app.get('/stop-random-container', (req, res) => {
  if (nodes.length === 0) {
    return res.status(400).send({ error: 'No hay nodos disponibles para detener.' });
  }

  const randomNode = nodes[Math.floor(Math.random() * nodes.length)];
  stopContainerById(randomNode.IDnode, (err) => {
    if (err) {
      console.error('Error al detener contenedor:', err.message);
      return res.status(500).send({ error: `Error: ${err.message}` });
    }

    nodes.splice(nodes.indexOf(randomNode), 1);
    console.log(`Nodo detenido: ${randomNode.IDnode}`);
    io.emit('updateNodes', nodes); // Actualizar nodos en el frontend
    res.status(200).send({ message: `Nodo detenido: ${randomNode.IDnode}` });
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
  const uniqueContainerName = `my-node-app-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

  const command = `
    cd ${directory} && \
    docker build -t my-node-app . && \
    docker run --rm --name ${uniqueContainerName} \
    -e IDNODE=${IDnode} \
    -e LEADER=${leader} \
    -e HOST_PORT=${hostPort} \
    -e CONTAINER_PORT=${containerPort} \
    -p ${hostPort}:${containerPort} my-node-app
  `;

  executeSSHCommand(command, callback);
}

function executeSSHCommand(command, callback) {
  const conn = new Client();

  conn.on('ready', () => {
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

  socket.on('newLeader', (data) => {
    leader = data;
    console.log(`Nuevo líder registrado: ${leader}`);
  });

  socket.on('disconnect', () => {
    console.log('Conexión WebSocket cerrada.');
  });
});

updateSocket.on('connect', () => {
  console.log('Conectado al WebSocket de un nodo.');
});

updateSocket.on('update', (data) => {
  console.log('Evento "update" recibido:', data);
  Object.assign(nodesInformation, data); // Actualiza
});

updateSocket.on('disconnect', () => {
  console.log('Desconectado del WebSocket de un nodo.');
});

updateSocket.on('connect_error', (error) => {
  console.error('Error al conectar al WebSocket de un nodo:', error.message);
});

// --- Inicializar servidor ---
server.listen(port, () => {
  console.log(`Servidor monitor corriendo en el puerto: ${port}`);
});
