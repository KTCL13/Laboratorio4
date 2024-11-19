const { createApp } = Vue;

// Configuración dinámica de IP y puerto
const ipSocket = window.location.origin;


createApp({
  data() {
    return {
        serverProperties:{
          healthCheckInverval: 0,
          logs:[],
          leaderStatus: false
        },
        serverInfo: ipSocket, // Información del servidor para el título
    };
  },
  mounted() {
    const socket = io(ipSocket); // Conexión al WebSocket

    // Recibir datos de WebSocket en tiempo real
    socket.on("update", (data) => {
      console.log("Mensaje recibido por WebSocket:", data);
      this.serverProperties = data.serverProperties; 
      console.log("nuevas propiedades:", this.serverProperties)
    });
  },
}).mount("#app");
