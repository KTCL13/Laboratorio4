const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');


const app = express();
const server = http.createServer(app);
const io = new Server(server);

const containerPort = process.env.CONTAINER_PORT || 3000;
const hostPort = process.env.HOST_PORT || 3000;
const ipAddress = process.env.IP_ADDRESS || "localhost"; 
const containerName = process.env.CONTAINER_NAME;
const disServerip= process.env.DIS_SERVERIP_PORT || "192.168.178.54:9000"


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
        body: JSON.stringify({ ipAddress: ipAddress, port: hostPort , id: containerName }),
      };
  
     const response = await fetch(`http://${disServerip}/discoveryserver`, requestOptions)
    } catch (error) {
      console.error('Error al obtener la IP:', error);
    }
};
  
server.listen(containerPort, startServer);
  