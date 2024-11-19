const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');
const process = require('process');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const containerPort = process.env.CONTAINER_PORT || 3002;
const hostPort = process.env.HOST_PORT || 3000;
const ipAddress = process.env.IP_ADDRESS || "localhost"; 
const containerName = process.env.CONTAINER_NAME;
const disServerip= process.env.DIS_SERVERIP_PORT || "192.168.178.54:9000"
const IDNode = process.env.IDNODE || 3;

const healthCheckInverval =  Math.random() * 5000 + 5000

const logs=[]
let leader = null;  // Variable para el líder
let leaderStatus = false;
let NODES = [{id:1 , address:"localhost:3000"}, {id:2 , address:"localhost:3001"},{id:3 , address:"localhost:3002"}];
let inElection = false

const serverProperties= {
    healthCheckInverval: healthCheckInverval,
    logs : logs,
    get leaderStatus() { return leaderStatus; }
}

app.use(express.json())
app.use(express.static(path.join(__dirname, 'frontend')));

function createLog(message){
    const log = new Date().toISOString() +" "+ message
    console.log(log)
    logs.push(log)
    io.emit("update", { serverProperties: serverProperties })
}

io.on("connection", (socket) => {
    console.log("Usuario conectado:", socket.id);
    io.emit("update", { serverProperties: serverProperties })
});

// Ruta principal que devuelve el archivo HTML
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend', 'index.html'));
});



app.get("/healthCheck", (req, res) => {
    res.status(200).send("ok");
});

async function performHealthCheck() {
    if(inElection||leaderStatus){
        return;
    }

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
        const response = await fetch(`http://${leaderNode.address}/healthCheck`);
        createLog(`${response.url} - method:GET - req.body:{from: ${IDNode}} status:${response.status}`)
        if (!response.ok) throw new Error("Líder no responde");
    } catch (error) {
        createLog(`URL: http://${leaderNode.address}/healthCheck - method:GET - error:${error.message}`)
        startElection();
    }
}

app.post('/election', (req, res) => {
    createLog(`URL: ${req.url} - method:${req.method} - payload:${JSON.stringify(req.body)}`)
    const { from } = req.body;
    startElection();
    res.status(200).send("Election response");
});

app.post('/newLeader', (req, res) => {
    createLog(`URL: ${req.url} - method:${req.method} - payload:${JSON.stringify(req.body)}`)
    inElection = false
    const { newLeader } = req.body;
    leader = newLeader
    leaderStatus = false
    res.status(200).send("Leader changed");
});


// Función para iniciar una elección
async function startElection() {
  inElection = true  
  console.log(`Nodo ${IDNode} iniciando elección.`);
  
  const higherNodes = NODES.filter(node => node.id > IDNode);

  if (higherNodes.length === 0) {
      declareLeader();
  } else {
      let resolvedResponses = 0;
      let unresolvedNodes = new Set(higherNodes.map(node => node.id));

      for (const node of higherNodes) {
          try {
                const response = await fetch(`http://${node.address}/election`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ from: IDNode }),
              });
              createLog(`${response.url} - method:POST - req.body:{from: ${IDNode}} status:${response.status} statusText:${response.statusText}`)
              if (response.ok) {
                  resolvedResponses++;
                  unresolvedNodes.delete(node.id);
              }
          } catch (error) {0
            createLog(`URL: http://${node.address}/election - method:POST - error:${error.message}`)
          }
      }

      // Esperar tiempo adicional para respuestas
      await new Promise(resolve => setTimeout(resolve, 8000));

      if (resolvedResponses === 0) {
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
    if (!IDNode) {
        console.error("IDNode no está definido. No se puede declarar líder.");
        return;
    }

    leader = IDNode;
    inElection = false;
    leaderStatus = true;
    console.log(`Nodo ${IDNode} se declara como líder.`);

    NODES.forEach(async (node) => {
        if (node.id !== IDNode) {
            try{
                const response=  await fetch(`http://${node.address}/newLeader`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ newLeader: IDNode })  
                })

                createLog(`${response.url} - method:POST - req.body:{newLeader: ${IDNode}} status:${response.status}`)

            }catch(error){
                createLog(`URL: http://${node.address}/newLeader - method:POST - error:${error.message}`)
            }
        }
    });
}


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
  
     const response = await fetch(`http://${disServerip}/register`, requestOptions)
     createLog(`${response.url} - method:POST - req.body:${requestOptions.body} status:${response.status}`)
    } catch (error) {
        createLog(`URL: http://${disServerip}/register- method:POST - error:${error.message}`)
    }
};



server.listen(containerPort, startServer);
setInterval(performHealthCheck, healthCheckInverval); 
  
