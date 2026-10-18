const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');

module.exports = async () => {
  // Start MongoDB Memory Server
  const mongod = new MongoMemoryServer({
    binary: {
      // 7.0.0 has no Debian 12 / Ubuntu 24.04 build, so the whole suite
      // failed in CI-like containers before running a single test.
      version: '7.0.14',
      skipMD5: true,
    },
    instance: {
      dbName: 'jomobit-test',
    },
  });

  await mongod.start();
  const uri = mongod.getUri();
  
  // Store the URI and instance for use in tests
  global.__MONGOD__ = mongod;
  global.__MONGO_URI__ = uri;
  
  // Set environment variables for tests
  process.env.NODE_ENV = 'test';
  process.env.MONGODB_URI = uri;
  process.env.JWT_SECRET = 'test-jwt-secret';
  process.env.AUTH0_DOMAIN = 'test.auth0.com';
  process.env.AUTH0_AUDIENCE = 'test-audience';
  process.env.REDIS_URL = 'redis://localhost:6379';
  process.env.IMAGEKIT_PUBLIC_KEY = 'test-public-key';
  process.env.IMAGEKIT_PRIVATE_KEY = 'test-private-key';
  process.env.IMAGEKIT_URL_ENDPOINT = 'https://test.imagekit.io';
  process.env.RAZORPAY_KEY_ID = 'test-razorpay-key';
  process.env.RAZORPAY_KEY_SECRET = 'test-razorpay-secret';
  process.env.OPENAI_API_KEY = 'test-openai-key';
  process.env.GEMINI_API_KEY = 'test-gemini-key';
  process.env.IDEOGRAM_API_KEY = 'test-ideogram-key';
  process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/test';
  
  console.log('MongoDB Memory Server started for tests');
};