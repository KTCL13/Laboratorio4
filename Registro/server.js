const express = require('express');
const axios = require('axios');
const cors = require("cors");
const { Client } = require('ssh2');

const app = express();
app.use(cors());
app.use(express.json());

const port = 3000; 

const nodes = [];


//metodo para registrar un nuevo nodo y enviarlo a los otros nodos
app.post("/register", async (req, res) => {
    console.log("Nuevo servidor:", req.body);
    const node = req.body;
    
    if(!nodes.some(instancesOb => instancesOb.ipAddress === node.ipAddress && instancesOb.port === node.port)){
        try {
        nodes.push(node)
           
        } catch (error) {
            console.error("Error al registrar:", error);
        }
    }else{
        console.log("IP:PORT ya esta en uso");
        res.status(200).end();
    }
    console.log(nodes)
});


const sshConfig = {
    host: process.env.SSH_HOST,  
    port: 22,           
    username: process.env.SSH_USERNAME,  
    password: process.env.SSH_PASSWORD,   
};

let portsData = { hostPort: 3000, containerPort: 3000 };

app.post('/run-docker', (req, res) => {
    console.log("/run-docker: iniciando una nueva instancia")
    const {IDnode} = req.body
    
    if (!IDnode) {
        return res.status(400).send("IDnode es obligatorio.");
    }
    
    if (isNaN(IDnode)) {
        return res.status(400).send("IDnode debe ser un número.");
    }
    
    runContainer(IDnode,(err, result) => {
        if (err) {
            return res.status(500).send(`Error: ${err.message}`);
        }
        res.status(200).send(`Container created: ${result}`);
    });
    console.log("/run-docker: end")
});

app.get('/stop-random-container', (req, res) => {
    console.log("/stop-random-container: Iniciando caos");

    if (connections.length === 0) {
        return res.status(400).send("No containers available to stop.");
    }

    const randomContainer = connections[Math.floor(Math.random() * connections.length)];

    stopContainerById(randomContainer.id, (err, result) => {
        if (err) {
            return res.status(500).send(`Error: ${err.message}`);
        }
        res.send(`Container with ID ${randomContainer.id} stopped successfully.`);
    });
    console.log("/stop-random-container: finalizando caos");
});


function stopContainerById(containerId, callback) {
    const command = `docker stop ${containerId}`;
    executeSSHCommand(command, callback);
}

function runContainer(IDnode,callback) {
    console.log(new Date(),"creando servidor");
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
        docker run --rm --name ${uniqueContainerName} \}
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
            stream.on('data', (chunk) => { outputData += chunk; });
            stream.stderr.on('data', (chunk) => { console.error(`STDERR: ${chunk}`); });
            stream.on('close', () => {
                conn.end();
                callback(null, outputData.trim());
            });
        });
    }).connect(sshConfig);
}

app.listen(port, () => {
    console.log(`Monitor corriendo en el puerto: ${port}`);
});
