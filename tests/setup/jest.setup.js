const mongoose = require('mongoose');

// Increase timeout for database operations
jest.setTimeout(30000);

// Several suites start their own MongoMemoryServer and call mongoose.connect()
// in their own beforeAll. Mongoose refuses a second connect() to a different
// URI, which failed those suites before a single test ran. Switch instead.
const connect = mongoose.connect.bind(mongoose);
mongoose.connect = async (...args) => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  return connect(...args);
};

// Setup before each test file
beforeAll(async () => {
  // Connect to MongoDB Memory Server
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(global.__MONGO_URI__, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
  }
});

// Cleanup after each test
afterEach(async () => {
  // Clear all collections
  const collections = mongoose.connection.collections;
  for (const key in collections) {
    const collection = collections[key];
    await collection.deleteMany({});
  }
  
  // Clear all mocks
  jest.clearAllMocks();
});

// Cleanup after all tests in a file
afterAll(async () => {
  // Close mongoose connection for this test file
  // Note: Global teardown will handle the final cleanup
});