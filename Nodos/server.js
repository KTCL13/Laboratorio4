const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');
const process = require('process');
const { io } = require("socket.io-client"); 
const { stat } = require('fs');


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
const healthCheckInterval =  Math.random() * 5000 + 5000

const logs=[]
let leader = 0;
let leaderStatus = false;
let NODES = [];
let inElection = true

const serverProperties= {
    idNode:IDNode,
    ipAddress: `${ipAddress}:${hostPort}`,
    healthCheckInterval: healthCheckInterval,
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
  
  

function createLog(type, url, method, payload, status ){
    const tipo = type === 0 ? "recibido" : "enviado";
    const log = {type:tipo, date: formatDate(), url: url , method: method , payload: payload, status: status }
    console.log(log)
    logs.push(log)
    ioserver.emit("update", serverProperties )
    socket.emit("update", serverProperties);
}

function createError(type, url, method, error ){
    const tipo = type === 0 ? "recibido" : "enviado";
    const log = {type:tipo, date: formatDate(), url: url , method: method , error: error}
    console.log(log)
    logs.push(log)
    ioserver.emit("update", serverProperties )
    socket.emit("update", serverProperties);
}


ioserver.on("connection", (socket) => {
    console.log("Usuario conectado:", socket.id);
    ioserver.emit("update",serverProperties )

});



socket.on("updateNodes", (data) => {
    console.log("Mensaje recibido por WebSocket:", data);
    NODES = data; 
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

    const leaderNode = NODES.find(node => node.IDNode === leader);
    if (!leaderNode) {
        console.log(`El líder ${leader} no está en la lista de nodos.`);
        startElection();
        return;
    }

    try {
        console.log(`Nodo ${IDNode} verificando estado del líder ${leader}.`);
        const response = await fetch(`http://${leaderNode.ipAddress}/healthCheck`);
        createLog(1,response.url, "GET", `from: ${IDNode}`, response.status);
        if (!response.ok) throw new Error("Líder no responde");
    } catch (error) {
        createError(1,`http://${leaderNode.ipAddress}/healthCheck `,"GET",error.message);
        socket.emit("election", IDNode);
        startElection();
    }
}

app.post('/election', (req, res) => {
    createLog(0,req.url, "POST", req.method, JSON.stringify(req.body));
    if(!leaderStatus){
        startElection();
    }
    res.status(200).send("Election response");
});

app.post('/newLeader', (req, res) => {
    createLog(0,req.url, "POST", req.method, JSON.stringify(req.body));
    inElection = false
    const { newLeader } = req.body;
    leader = newLeader
    if(leader !== IDNode){
        leaderStatus = false
    }
    res.status(200).send("Leader changed");
});



async function startElection() {
    inElection = true;
    
    console.log(`Nodo ${IDNode} iniciando elección.`);
    
    const higherNodes = NODES.filter(node => Number(node.IDNode) > Number(IDNode));
  
    if (higherNodes.length === 0) {
        declareLeader();
    } else {
        let unresolvedNodes = new Set(higherNodes.map(node => node.IDNode));
  
        const promises = higherNodes.map(async (node) => {
            try {
                const response = await fetch(`http://${node.ipAddress}/election`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ from: IDNode }),
                });
                createLog(1, response.url, "POST", `from: ${IDNode}`, response.status);
  
                if (response.ok) {
                    unresolvedNodes.delete(node.IDNode);
                }
            } catch (error) {
                createError(1, `http://${node.ipAddress}/election`, "POST", error.message);
            }
        });
  
        await Promise.all(promises);
  
        if (unresolvedNodes.size === higherNodes.length) {
            declareLeader();
        } else {
            console.log(`Nodo ${IDNode} no se declara líder, esperando confirmación de nodos con ID más alto.`);
        }
    }
    
    inElection = false;
  }

// Función para iniciar una elección

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
    socket.emit("update", serverProperties);

    console.log(NODES);


    const promises = NODES.map(async (node) => {
        if (node.IDNode !== IDNode) {
            try {
                const response = await fetch(`http://${node.ipAddress}/newLeader`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ newLeader: IDNode }),
                });

                createLog(1, response.url, "POST", `newLeader: ${IDNode}`, response.status);
            } catch (error) {
                createError(1, `http://${node.ipAddress}/newLeader`, "POST", error.message);
            }
        }
    });


    Promise.all(promises)
        .then(() => {
            console.log("Notificación de nuevo líder enviada a todos los nodos.");
        })
        .catch((error) => {
            console.error("Error al notificar a algunos nodos:", error);
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
        console.log(requestOptions.body)
        try {
            const response = await fetch(`http://${disServerip}/register`, requestOptions);
            createLog(1,response.url, "POST", requestOptions.body, response.status);
            const response2 = await fetch(`http://${disServerip}/leader`)
            if (response2.status === 204) {
                createLog(1,response2.url, "GET","no llego jefe", response2.status);
                declareLeader()
            }else{
                const leaderText = await response2.text(); 
                createLog(1,response2.url, "GET",leaderText, response2.status);
                leader = leaderText;
            }
        } catch (error) {
            createError(1,`http://${disServerip}/register`,"POST",error.message);
        }
    });

    socket.on("connect_error", (error) => {
        console.error("Error conectando a disServer:", error.message);
    });

    } catch (error) {
        createError(1,`http://${disServerip}/register`,"POST",error.message);
    }
    inElection=false
};



server.listen(containerPort, startServer);
setInterval(performHealthCheck, healthCheckInterval); 
  
