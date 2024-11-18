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

let leader = null;  // Variable para el líder
let NODES = []; // Lista de nodos vacía inicialmente

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


// Ruta para recibir mensajes de elección
app.post('/election', (req, res) => {
    const { from } = req.body;
    console.log(`Nodo ${IDNode} recibió mensaje de elección de Nodo ${from}.`);
    res.status(200).send("Election response");

    if (from < IDNode) {
        console.log(`Nodo ${IDNode} iniciará su propia elección.`);
        startElection();
    }
});

// Ruta para recibir notificaciones de nuevo líder
app.post('/newLeader', (req, res) => {
    const { leader: newLeader } = req.body;
    leader = newLeader;
    console.log(`Nodo ${IDNode} reconoce al nuevo líder: Nodo ${leader}.`);
    res.status(200).send("Acknowledged new leader");
});

// Función para actualizar la lista de nodos desde el "DiscoveryServer"
async function updateNodeList() {
    try {
        // Realizar una solicitud al servidor de descubrimiento para obtener la lista de nodos
        const response = await fetch(`http://${disServerip}/discoveryserver`);
        
        if (response.ok) {
            const nodesData = await response.json(); // Suponiendo que el servidor devuelve un JSON con la lista de nodos
            NODES = nodesData.nodes; // Actualizar la lista de nodos
            console.log("Lista de nodos actualizada:", NODES);
        } else {
            console.log("Error al obtener la lista de nodos desde el servidor de descubrimiento.");
        }
    } catch (error) {
        console.error("Error al actualizar la lista de nodos:", error);
    }
}
// Funcion para realizar un health check al líder
async function performHealthCheck() {
    if (!leader) {
        console.log("No hay líder. Iniciando elección.");
        startElection();
        return;
    }

    const leaderNode = NODES.find(node => node.id === leader);
    if (!leaderNode) {
        console.log(`El líder ${leader} no está en la lista de nodos.`);
        startElection();
        return;
    }

    try {
        console.log(`Nodo ${IDNode} verificando estado del líder ${leader}.`);
        const response = await fetch(`${leaderNode.address}/healthCheck`);
        if (!response.ok) throw new Error("Líder no responde");
    } catch (error) {
        console.log(`Líder ${leader} no responde. Iniciando elección.`);
        startElection();
    }
}

// Función para iniciar una elección
async function startElection() {
  console.log(`Nodo ${IDNode} iniciando elección.`);
  
  // Actualizar nodos activos antes de proceder
  await updateActiveNodes();
  await updateNodeList();

  const higherNodes = NODES.filter(node => node.id > IDNode && node.active);

  if (higherNodes.length === 0) {
      declareLeader();
  } else {
      let resolvedResponses = 0;
      let unresolvedNodes = new Set(higherNodes.map(node => node.id));

      for (const node of higherNodes) {
          try {
              console.log(`Nodo ${IDNode} enviando mensaje de elección a Nodo ${node.id}.`);
              const response = await fetch(`${node.address}/election`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ from: IDNode }),
              });

              if (response.ok) {
                  resolvedResponses++;
                  unresolvedNodes.delete(node.id);
                  console.log(`Nodo ${node.id} respondió correctamente.`);
              }
          } catch (error) {
              console.log(`Nodo ${node.id} no respondió a la elección.`);
          }
      }

      // Esperar tiempo adicional para respuestas
      await new Promise(resolve => setTimeout(resolve, 8000));

      if (resolvedResponses === 0 && unresolvedNodes.size === 0) {
          declareLeader();
      } else {
          console.log(`Nodo ${IDNode} no se declara líder, esperando confirmación de nodos con ID más alto.`);
      }
  }
}

async function updateActiveNodes() {
  for (const node of NODES) {
      try {
          const response = await fetch(`${node.address}/healthCheck`, { method: "GET" });
          node.active = response.ok;
      } catch (error) {
          node.active = false;
          console.log(`Nodo ${node.id} no está activo.`);
      }
  }
}


function declareLeader() {
  leader = IDNode;
  console.log(`Nodo ${IDNode} se declara como líder.`);

  NODES.forEach(node => {
      if (node.id !== IDNode && node.active) {
          fetch(`${node.address}/newLeader`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ leader: IDNode }),
          }).catch(error => {
              console.log(`No se pudo notificar a Nodo ${node.id} sobre el nuevo líder.`);
          });
      }
  });
}
server.listen(containerPort, startServer);
setInterval(performHealthCheck, Math.random() * 5000 + 5000); // Health check cada 5-10 segundos
  
