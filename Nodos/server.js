const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');
const process = require('process');


const app = express();
const server = http.createServer(app);
const io = new Server(server);

const containerPort = process.env.CONTAINER_PORT || 3000;
const hostPort = process.env.HOST_PORT || 3000;
const ipAddress = process.env.IP_ADDRESS || "localhost"; 
const containerName = process.env.CONTAINER_NAME;
const disServerip= process.env.DIS_SERVERIP_PORT || "192.168.178.54:9000"
const IDNode = process.env.IDNODE


app.use(express.static(path.join(__dirname, 'frontend')));


io.on("connection", (socket) => {
    console.log("Usuario conectado:", socket.id);
});

// Ruta principal que devuelve el archivo HTML
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend', 'index.html'));
});



app.get("/healthCheck", (req, res) => {

    io.emit("update", { servers:"ok"})
    res.status(200).send("ok");
});

const startServer = async () => {
    try {
      console.log('IP del host:', ipAddress);
      console.log('ID del contenedor:', containerName);
      console.log('HostPort:', hostPort);
      console.log("ipDIS:", disServerip);
      console.log(`Servidor corriendo en el puerto: ${containerPort}`);
  
      const requestOptions = {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ipAddress: ipAddress, port: hostPort , id: containerName , IDNode:IDNode }),
      };
  
     const response = await fetch(`http://${disServerip}/discoveryserver`, requestOptions)
    } catch (error) {
      console.error('Error al obtener la IP:', error);
    }
};
// Función para iniciar una elección
function startElection() {
  console.log(`Iniciando elección desde el nodo ${IDNode}`);
  const higherNodes = nodes.filter(node => node.id > IDNode && node.active);

  if (higherNodes.length === 0) {
      declareLeader();
  } else {
      let responses = 0;
      higherNodes.forEach(node => {
        console.log(`Nodo ${IDNode} envía mensaje de elección a Nodo ${node.id}`);
        io.emit("election", { from: IDNode, to: node.id });
    });
    
    // Escuchar respuestas de elección globalmente
    io.on("electionResponse", (msg) => {
        if (msg.to === IDNode) {
            responses++;
            console.log(`Nodo ${msg.from} responde a la elección.`);
    
            if (responses >= nodes.filter(node => node.id > IDNode && node.active).length) {
                declareLeader();
            }
        }
    });    
  }
}
// Función para declarar al líder
function declareLeader() {
  leader = IDNode;
  console.log(`Nodo ${IDNode} se declara como líder`);
  io.emit("newLeader", { leader: leader });
}

// Función para manejar notificación de nuevo líder
io.on("newLeader", (msg) => {
  leader = msg.leader;
  console.log(`El nuevo líder es el nodo ${leader}`);
});
// Función para realizar un health check al líder
function performHealthCheck() {
  if (leader !== null && leader !== IDNode) {
      console.log(`Verificando estado del líder ${leader}`);
      const isLeaderAlive = Math.random() > 0.2; // Simulación

      if (!isLeaderAlive) {
          console.log(`Líder ${leader} no responde, iniciando elección`);
          startElection();
      }
  } else if (leader === null) {
      console.log("No hay líder, iniciando elección.");
      startElection();
  }
} 
  
server.listen(containerPort, startServer);
  
