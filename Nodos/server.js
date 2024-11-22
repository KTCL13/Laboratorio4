const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');
const process = require('process');
const { io } = require("socket.io-client"); 


const app = express();
const server = http.createServer(app);
const ioserver = new Server(server);

const containerPort = process.env.CONTAINER_PORT || 3000;
const hostPort = process.env.HOST_PORT || 3000;
const ipAddress = process.env.IP_ADDRESS || "localhost"; 
const containerName = process.env.CONTAINER_NAME;
const disServerip= process.env.DIS_SERVERIP_PORT || "localhost:9000"
const IDNode = process.env.IDNODE || 1;
const socket = io(`http://${disServerip}`);
const healthCheckInverval =  Math.random() * 5000 + 5000

const logs=[]
let leader = process.env.LEADER 
let leaderStatus = false;
let NODES = [];
let inElection = false

const serverProperties= {
    healthCheckInverval: healthCheckInverval,
    logs : logs,
    get leaderStatus() { return leaderStatus; }
}



app.use(express.json())
app.use(express.static(path.join(__dirname, 'frontend')));


function formatDate () {
    const date = new Date();
  
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0'); 
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    const milliseconds = String(date.getMilliseconds()).padStart(3, '0');

    return `${year}/${month}/${day} ${hours}:${minutes}:${seconds}:${milliseconds}`;
  };
  
  

function createLog(message){
    const log = formatDate() +" "+ message
    console.log(log)
    logs.push(log)
    ioserver.emit("update", { serverProperties: serverProperties })
}

ioserver.on("connection", (socket) => {
    console.log("Usuario conectado:", socket.id);
    ioserver.emit("update", { serverProperties: serverProperties })

});



socket.on("updateNodes", (data) => {
    console.log("Mensaje recibido por WebSocket:", data);
    NODES = data; 
    console.log("nodes actuales:" + NODES)
});


// Ruta principal que devuelve el archivo HTML
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend', 'index.html'));
});



app.get("/healthCheck", (req, res) => {
    createLog(`URL: ${req.url} - method:${req.method} - from:${req.ip}`)
    res.status(200).send("ok");
});

async function performHealthCheck() {

    console.log(leader)
    if(inElection||leaderStatus){
        return;
    }

    if (!leader) {
        console.log("No hay líder. Iniciando elección.");
        startElection();
        return;
    }

    const leaderNode = NODES.find(node => node.IDNode === leader);
    if (!leaderNode) {
        console.log(`El líder ${leader} no está en la lista de nodos.`);
        startElection();
        return;
    }

    try {
        console.log(`Nodo ${IDNode} verificando estado del líder ${leader}.`);
        const response = await fetch(`http://${leaderNode.ipAddress}/healthCheck`);
        createLog(`${response.url} - method:GET - req.body:{from: ${IDNode}} status:${response.status}`)
        if (!response.ok) throw new Error("Líder no responde");
    } catch (error) {
        createLog(`URL: http://${leaderNode.ipAddress}/healthCheck - method:GET - error:${error.message}`)
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
    if(leader !== IDNode){
        leaderStatus = false
    }
    res.status(200).send("Leader changed");
});


// Función para iniciar una elección
async function startElection() {
  inElection = true  
  console.log(`Nodo ${IDNode} iniciando elección.`);
  
  const higherNodes = NODES.filter(node => node.IDNode > IDNode);

  if (higherNodes.length === 0) {
      declareLeader();
  } else {
      let resolvedResponses = 0;
      let unresolvedNodes = new Set(higherNodes.map(node => node.IDNode));

      for (const node of higherNodes) {
          try {
                const response = await fetch(`http://${node.ipAddress}/election`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ from: IDNode }),
              });
              createLog(`${response.url} - method:POST - req.body:{from: ${IDNode}} status:${response.status} statusText:${response.statusText}`)
              if (response.ok) {
                  resolvedResponses++;
                  unresolvedNodes.delete(node.IDNode);
              }
          } catch (error) {0
            createLog(`URL: http://${node.ipAddress}/election - method:POST - error:${error.message}`)
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


function declareLeader() {
    if (!IDNode) {
        console.error("IDNode no está definido. No se puede declarar líder.");
        return;
    }

    leader = IDNode;
    inElection = false;
    leaderStatus = true;
    console.log(`Nodo ${IDNode} se declara como líder.`);

    socket.emit("newLeader", IDNode);

    NODES.forEach(async (node) => {
 
    try{
        const response=  await fetch(`http://${node.ipAddress}/newLeader`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ newLeader: IDNode })  
        })

        createLog(`${response.url} - method:POST - req.body:{newLeader: ${IDNode}} status:${response.status}`)

    }catch(error){
        createLog(`URL: http://${node.ipAddress}/newLeader - method:POST - error:${error.message}`)
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

      const ipAddressPort= `${ipAddress}:${hostPort}`
  
      socket.on("connect", async () => {
        console.log("Conexión establecida con el servidor disServer");

        // Enviar la petición de registro después de conectar con disServer
        const requestOptions = {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ipAddress: ipAddressPort, id: containerName, IDNode: IDNode }),
        };

        try {
            const response = await fetch(`http://${disServerip}/register`, requestOptions);
            createLog(`${response.url} - method:POST - req.body:${requestOptions.body} status:${response.status}`);
        } catch (error) {
            createLog(`URL: http://${disServerip}/register - method:POST - error:${error.message}`);
        }
    });

    socket.on("connect_error", (error) => {
        console.error("Error conectando a disServer:", error.message);
    });

    } catch (error) {
        createLog(`URL: http://${disServerip}/register- method:POST - error:${error.message}`)
    }
};



server.listen(containerPort, startServer);
setInterval(performHealthCheck, healthCheckInverval); 
  
