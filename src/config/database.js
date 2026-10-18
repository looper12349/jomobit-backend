const mongoose = require('mongoose');
const logger = require('../utils/logger');

class DatabaseConnection {
  constructor() {
    this.connection = null;
  }

  async connect() {
    try {
      const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/jomobit';
      
      const options = {
        // useNewUrlParser: true,
        // useUnifiedTopology: true,
        // maxPoolSize: 10,
        // serverSelectionTimeoutMS: 5000,
        // socketTimeoutMS: 45000,
        // bufferMaxEntries: 0,
        // bufferCommands: false,
      };

      this.connection = await mongoose.connect(mongoUri, options);
      
      logger.info('MongoDB connected successfully', {
        host: this.connection.connection.host,
        port: this.connection.connection.port,
        database: this.connection.connection.name
      });

      // Handle connection events
      mongoose.connection.on('error', (error) => {
        logger.error('MongoDB connection error:', error);
      });

      mongoose.connection.on('disconnected', () => {
        logger.warn('MongoDB disconnected');
      });

      mongoose.connection.on('reconnected', () => {
        logger.info('MongoDB reconnected');
      });

      return this.connection;
    } catch (error) {
      logger.error('MongoDB connection failed:', error);
      throw error;
    }
  }

  async disconnect() {
    if (this.connection) {
      await mongoose.disconnect();
      logger.info('MongoDB disconnected');
    }
  }

  getConnection() {
    return this.connection;
  }

  // 1 = connected. Used by the readiness probe so a pod that has lost
  // MongoDB stops receiving traffic instead of failing requests.
  isReady() {
    return mongoose.connection.readyState === 1;
  }
}

module.exports = new DatabaseConnection();