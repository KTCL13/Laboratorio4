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
          :key="node.idNode"
          class="bg-white shadow-md rounded-lg p-4 border"
        >
          <!-- Header de la tarjeta -->
          <div class="flex justify-between items-center mb-2">
            <h2 class="text-lg font-bold">
              Nodo ID: <span class="text-blue-500">{{ node.idNode }}</span>
            </h2>
            <span
              class="px-2 py-1 text-xs font-semibold rounded"
              :class="node.leaderStatus ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-600'"
            >
              {{ node.leaderStatus ? 'Líder' : 'Miembro' }}
            </span>
            <span
              class="px-2 py-1 text-xs font-semibold rounded"
              :class="node.idNode == electionNode ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-600'"
            >
              {{ node.idNode == electionNode ? 'election' : '' }}
            </span>
          </div>

          <!-- Estado y uptime -->
          <p class="text-sm mb-2">
            <span class="font-semibold">Estado:</span>
            <span :class="node.status === 'up' ? 'text-green-500' : 'text-red-500'">
              {{ node.status }}
            </span>
          </p>

          <!-- Logs -->
          <div>
            <h3 class="text-sm font-semibold mb-1">Logs:</h3>
            <div class="bg-gray-100 p-2 rounded max-h-32 overflow-y-auto">
              <p
               v-for="(log, index) in node.logs"
              :key="index"
                class="text-xs text-gray-800"
              >
              *[{{ log }}]*
              </p>  
            </div>
          </div>

          <!-- Botón de eliminar -->
          <div class="mt-4 text-right">
            <button
              @click="deleteNode(node.idNode)"
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

const ipAddress = "http://localhost:9000"
export default {
  data() {
    return {
      nodes: [],
      newNodeId: '',
      electionNode: 0,
      socket: null,
    };
  },
  methods: {
    async createNode() {
      if (!this.newNodeId.trim()) return;

      try {
        console.log(`Creando nodo con id ${this.newNodeId}`)
        await axios.post(`${ipAddress}/run-docker`, {
          IDnode: this.newNodeId
        });
        this.newNodeId = '';
        console.log("Nodo creado")
      } catch (error) {
        console.error('Error al crear nodo:', error);
      }
    },
    async deleteNode(idNode) {
      try {
        console.log("Parando el nodo:", idNode)
        await axios.post(`${ipAddress}/stop-container`, {IDnode: idNode});
        } catch (error) {
        console.error('Error al parar nodo:', error);
      }
    },
  },
  mounted() {
    this.electionNode = 0
    const socket = io(ipAddress); 

    socket.on("update", (data) => {
    console.log("Mensaje recibido por WebSocket:", data);
    this.nodes = data;
    });

    socket.on("election", (data) => {
    this.electionNode=data
    });
  },
};
</script>
