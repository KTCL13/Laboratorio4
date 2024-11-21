<template>
  <div class="p-6 bg-gray-100 min-h-screen">
    <div class="max-w-4xl mx-auto">
      <h1 class="text-3xl font-bold mb-6 text-center">Node Monitoring Dashboard</h1>

      <!-- Crear nodo -->
      <div class="flex items-center mb-8">
        <input
          v-model="newNodeId"
          type="text"
          placeholder="Ingrese ID del nodo"
          class="border border-gray-300 rounded-md p-2 flex-1 mr-4"
        />
        <button
          @click="createNode"
          class="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
        >
          Crear Nodo
        </button>
      </div>

      <!-- Lista de nodos -->
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-6">
        <div
          v-for="node in nodes"
          :key="node.IDnode"
          class="bg-white shadow-md rounded-lg p-4 border"
        >
          <!-- Header de la tarjeta -->
          <div class="flex justify-between items-center mb-2">
            <h2 class="text-lg font-bold">
              Nodo ID: <span class="text-blue-500">{{ node.IDnode }}</span>
            </h2>
            <span
              class="px-2 py-1 text-xs font-semibold rounded"
              :class="node.isLeader ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-600'"
            >
              {{ node.isLeader ? 'Líder' : 'Miembro' }}
            </span>
          </div>

          <!-- Estado y uptime -->
          <p class="text-sm mb-2">
            <span class="font-semibold">Estado:</span>
            <span :class="node.status === 'up' ? 'text-green-500' : 'text-red-500'">
              {{ node.status }}
            </span>
          </p>
          <p class="text-sm text-gray-600 mb-4">
            Tiempo activo: {{ node.uptime || 'N/A' }}
          </p>

          <!-- Logs -->
          <div>
            <h3 class="text-sm font-semibold mb-1">Logs:</h3>
            <div class="bg-gray-100 p-2 rounded max-h-32 overflow-y-auto">
              <p
                v-for="log in node.logs"
                :key="log.timestamp"
                class="text-xs text-gray-800"
              >
                [{{ log.timestamp }}] {{ log.message }}
              </p>  
            </div>
          </div>

          <!-- Botón de eliminar -->
          <div class="mt-4 text-right">
            <button
              @click="deleteNode()"
              class="bg-red-500 text-white px-3 py-1 rounded hover:bg-red-600"
            >
              Eliminar Nodo
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import axios from 'axios';
import { io } from 'socket.io-client';

export default {
  data() {
    return {
      nodes: [],
      newNodeId: '',
      socket: null,
    };
  },
  methods: {
    async fetchNodes() {
      try {
        console.log("Obteniendo informacion de los nodos manualmente.")
        const response = await axios.get('http://localhost:9000/nodes');
        this.nodes = response.data.nodes.map((node) => ({
          ...node,
          isLeader: false,
          status: 'up', // Default status
          logs: [], // Logs iniciales
        }));
        console.log(`Informacion recibida: ${this.nodes}`)
      } catch (error) {
        console.error('Error al obtener nodos:', error);
      }
    },
    async createNode() {
      if (!this.newNodeId.trim()) return;

      try {
        console.log(`Creando nodo con id ${this.newNodeId}`)
        await axios.post('http://localhost:9000/run-docker', {
          IDnode: this.newNodeId,
        });
        this.fetchNodes();
        this.newNodeId = '';
        console.log("Nodo creado")
      } catch (error) {
        console.error('Error al crear nodo:', error);
      }
    },
    async deleteNode() {
      try {
        console.log("Parando un nodo al azar")
        await axios.get(`http://localhost:9000/stop-random-container`);
        this.fetchNodes();
      } catch (error) {
        console.error('Error al parar nodo:', error);
      }
    },
    setupWebSocket() {
      console.log("WebSockets para updateNodes iniciado")
      this.socket = io('http://localhost:9000');
      this.socket.on('updateNodes', (nodes) => {
        console.log(`Informacion de updateNodes recibida: ${nodes}`)
        this.nodes = nodes;
      });
    },
  },
  mounted() {
    this.fetchNodes();
    this.setupWebSocket();
  },
};
</script>
