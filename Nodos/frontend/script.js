const { createApp } = Vue;

// Configuración dinámica de IP y puerto
const ipSocket = window.location.origin;


createApp({
  data() {
    return {
        serverProperties:{
          idNode: 0,
          healthCheckInterval: 0,
          logs:[],
          leaderStatus: false
        },
        serverInfo: ipSocket, // Información del servidor para el título
    };
  },
  methods: {
    getLogClass(log) {
      if (log.error) return "log-error";
      if (log.type === "recibido") return "log-recibido"; 
      if (log.type === "enviado") return "log-enviado"; 
      return ""; 
    }
  },
  mounted() {
    const socket = io(ipSocket); // Conexión al WebSocket

    // Recibir datos de WebSocket en tiempo real
    socket.on("update", (data) => {
      console.log("Mensaje recibido por WebSocket:", data);
      this.serverProperties = data;
      console.log(this.serverProperties)
      console.log("nuevas propiedades:", this.serverProperties)
    });
  },
}).mount("#app");
