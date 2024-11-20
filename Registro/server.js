const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const axios = require('axios');
const { Client } = require('ssh2');

// Configuración inicial
const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(cors());
app.use(express.json());

// Puerto del servidor
const port = 3000;

// Almacenamiento en memoria para nodos
const nodes = [];
const connections = [];

// Configuración SSH
const sshConfig = {
  host: process.env.SSH_HOST,
  port: 22,
  username: process.env.SSH_USERNAME,
  password: process.env.SSH_PASSWORD,
};

let portsData = { hostPort: 3000, containerPort: 3000 };

// --- Endpoints ---

// Registro de un nuevo nodo
app.post('/register', async (req, res) => {
    console.log('Nuevo servidor:', req.body);
    const node = req.body;
  
    // Verificar duplicados
    if (!nodes.some(n => n.id === node.id)) {
      try {
        nodes.push(node);
        console.log(`Nodo registrado: ${node.id}`);
        
        // Propagar a todos los nodos la lista actualizada
        io.emit('updateNodes', { nodes });
        
        // Evaluar si debe iniciar una elección
        const leaderNode = nodes.find(n => n.leader);
        if (!leaderNode || node.id > leaderNode.id) {
          console.log(`Iniciando elección de líder desde nodo ${node.id}`);
          io.emit('startElection', { initiator: node.id });
        }
  
        res.status(201).send({ message: 'Nodo registrado y propagado exitosamente.' });
      } catch (error) {
        console.error('Error al registrar nodo:', error);
        res.status(500).send({ error: 'Error interno al registrar nodo.' });
      }
    } else {
      console.log('Nodo duplicado.');
      res.status(409).send({ error: 'Nodo duplicado.' });
    }
  });

// Endpoint para crear un nuevo nodo mediante Docker
app.post('/run-docker', (req, res) => {
  console.log('/run-docker: iniciando una nueva instancia');
  const { IDnode } = req.body;

  if (!IDnode) {
    return res.status(400).send({ error: 'IDnode es obligatorio.' });
  }

  runContainer(IDnode, (err, result) => {
    if (err) {
      console.error('Error al crear contenedor:', err.message);
      return res.status(500).send({ error: `Error: ${err.message}` });
    }
    console.log(`Contenedor creado: ${result}`);
    res.status(201).send({ message: `Contenedor creado: ${result}` });
  });
});

// Endpoint para detener un nodo aleatorio
app.get('/stop-random-container', (req, res) => {
  console.log('/stop-random-container: iniciando caos');

  if (connections.length === 0) {
    return res.status(400).send({ error: 'No hay contenedores disponibles para detener.' });
  }

  const randomContainer = connections[Math.floor(Math.random() * connections.length)];

  stopContainerById(randomContainer.id, (err, result) => {
    if (err) {
      console.error('Error al detener contenedor:', err.message);
      return res.status(500).send({ error: `Error: ${err.message}` });
    }
    console.log(`Contenedor detenido: ${randomContainer.id}`);
    res.status(200).send({ message: `Contenedor ${randomContainer.id} detenido exitosamente.` });
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

  socket.on('register', (data) => {
    console.log(`Nodo conectado por WebSocket: ${data.id}`);
    connections.push({ id: data.id, socketId: socket.id });
  });

  socket.on('disconnect', () => {
    console.log('Conexión WebSocket cerrada.');
  });
});

// --- Inicializar servidor ---
server.listen(port, () => {
  console.log(`Monitor corriendo en el puerto: ${port}`);
});
