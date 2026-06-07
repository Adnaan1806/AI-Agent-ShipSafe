// In-process SSE emitter. Replace with Redis pub/sub for multi-process/multi-instance deployments.
const listeners = new Map();

export const sseEmitter = {
  on(channel, callback) {
    if (!listeners.has(channel)) listeners.set(channel, new Set());
    listeners.get(channel).add(callback);
    return () => {
      listeners.get(channel)?.delete(callback);
      if (listeners.get(channel)?.size === 0) listeners.delete(channel);
    };
  },

  emit(channel, data) {
    listeners.get(channel)?.forEach((cb) => cb(data));
  },
};
