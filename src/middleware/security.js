const rateLimit = require('express-rate-limit');
const slowDown = require('express-slow-down');
const crypto = require('crypto');
const hpp = require('hpp');
const logger = require('../utils/logger');

/**
 * Enhanced rate limiting with different tiers for different endpoints
 */
const createRateLimit = (options = {}) => {
  const {
    windowMs = 15 * 60 * 1000, // 15 minutes
    max = 100,
    message = 'Too many requests from this IP, please try again later.',
    skipSuccessfulRequests = false,
    skipFailedRequests = false,
    keyGenerator, // Use default IP key generator
    onLimitReached = null
  } = options;

  


  const config = {
    windowMs,
    max,
    message: {
      error: message,
      retryAfter: Math.ceil(windowMs / 1000)
    },
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests,
    skipFailedRequests,
    keyGenerator,
    handler: (req, res, next, options) => {
      logger.warn('Rate limit exceeded', {
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        url: req.url,
        method: req.method,
        limit: options.max,
        windowMs: options.windowMs,
        timestamp: new Date().toISOString()
      });

      if (onLimitReached) {
        onLimitReached(req, res, next, options);
      }

      res.status(429).json({
        error: message,
        retryAfter: Math.ceil(windowMs / 1000),
        timestamp: new Date().toISOString()
      });
    }
  };

  // Only add keyGenerator if it's defined
  if (keyGenerator) {
    config.keyGenerator = keyGenerator;
  }

  return rateLimit(config);

};

/**
 * Different rate limiting configurations for different endpoint types
 */
const rateLimitConfigs = {
  // General API endpoints
  general: createRateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 1000,
    message: 'Too many requests from this IP, please try again later.'
  }),

  // Authentication endpoints (more restrictive)
  auth: createRateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 20,
    message: 'Too many authentication attempts, please try again later.',
    skipSuccessfulRequests: true
  }),

  // Poster generation (resource intensive)
  generation: createRateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 50,
    message: 'Too many generation requests, please try again later.'
  }),

  // Admin endpoints (very restrictive)
  admin: createRateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 50,
    message: 'Too many admin requests, please try again later.'
  }),

  // Webhook endpoints
  webhook: createRateLimit({
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 200,
    message: 'Too many webhook requests, please try again later.'
  }),

  // File upload endpoints
  upload: createRateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 20,
    message: 'Too many upload requests, please try again later.'
  })
};

/**
 * Slow down middleware for progressive delays
 */
const createSlowDown = (options = {}) => {
  const {
    windowMs = 15 * 60 * 1000, // 15 minutes
    delayAfter = 50,
    delayMs = 500,
    maxDelayMs = 20000,
    skipFailedRequests = false,
    skipSuccessfulRequests = false
  } = options;

  return slowDown({
    windowMs,
    delayAfter,
    delayMs,
    maxDelayMs,
    skipFailedRequests,
    skipSuccessfulRequests,
    onLimitReached: (req, res, options) => {
      logger.warn('Slow down limit reached', {
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        url: req.url,
        method: req.method,
        delayAfter: options.delayAfter,
        currentDelay: options.delay,
        timestamp: new Date().toISOString()
      });
    }
  });
};

/**
 * Webhook signature validation middleware
 */

// const validateWebhookSignature = (secretKey, headerName = 'x-signature-256') => {
//   return (req, res, next) => {
//     try {
//       const signature = req.get(headerName);
      
//       if (!signature) {
//         logger.warn('Missing webhook signature', {
//           ip: req.ip,
//           userAgent: req.get('User-Agent'),
//           url: req.url,
//           method: req.method,
//           headers: Object.keys(req.headers),
//           timestamp: new Date().toISOString()
//         });
        
//         return res.status(401).json({
//           error: 'Missing webhook signature',
//           code: 'MISSING_SIGNATURE'
//         });
//       }

//       // Get raw body for signature verification
//       // const rawBody = req.rawBody || JSON.stringify(req.body);

//       // rawCandidate: Buffer | string | object
//       const rawCandidate = req.body ?? req.rawBody ?? '';

//       // Normalize to buffer of bytes Razorpay signed:
//       let rawBuffer;
//       if (Buffer.isBuffer(rawCandidate)) {
//         rawBuffer = rawCandidate;
//       } else if (typeof rawCandidate === 'string') {
//         rawBuffer = Buffer.from(rawCandidate, 'utf8');
//       } else {
//         // If it's an object, stringify (last resort — but this should not be used for razorpay)
//         rawBuffer = Buffer.from(JSON.stringify(rawCandidate), 'utf8');
//       }

      
//       // Calculate expected signature
//       const expectedHex = crypto
//         .createHmac('sha256', secretKey)
//         .update(rawBuffer)
//         .digest('hex');

      
//       // const expected =
//       //   headerName === 'x-razorpay-signature'
//       //     ? expectedSignature
//       //     : `sha256=${expectedSignature}`;
      
//       // const expectedSignatureWithPrefix = `sha256=${expectedSignature}`;

//       let expected;
//       if (headerName === 'x-razorpay-signature') {
//         // signature header should be plain hex
//         // Received signature may be hex string; if header included "sha256=" remove it
//         const receivedHex = signature.startsWith('sha256=') ? signature.slice(7) : signature;

//         // Ensure lengths match
//         if (receivedHex.length !== expectedHex.length) {
//           logger.warn('Invalid signature length', { expectedLen: expectedHex.length, receivedLen: receivedHex.length });
//           return res.status(401).json({ error: 'Invalid webhook signature', code: 'INVALID_SIGNATURE' });
//         }

//         // timing-safe compare buffers of hex
//         const isValid = crypto.timingSafeEqual(Buffer.from(receivedHex, 'hex'), Buffer.from(expectedHex, 'hex'));
//         if (!isValid) {
//           logger.warn('Invalid webhook signature compare failed');
//           return res.status(401).json({ error: 'Invalid webhook signature', code: 'INVALID_SIGNATURE' });
//         }
        
        

//       }

//       else {
//         // other providers: header may be formatted like 'sha256=...'
//         const expectedWithPrefix = `sha256=${expectedHex}`;
//         if (signature.length !== expectedWithPrefix.length) {
//           logger.warn('Invalid signature length', { expectedLen: expectedWithPrefix.length, receivedLen: signature.length });
//           return res.status(401).json({ error: 'Invalid webhook signature', code: 'INVALID_SIGNATURE' });
//         }
//         const isValid = crypto.timingSafeEqual(Buffer.from(signature, 'utf8'), Buffer.from(expectedWithPrefix, 'utf8'));
//         if (!isValid) {
//           logger.warn('Invalid webhook signature compare failed');
//           return res.status(401).json({ error: 'Invalid webhook signature', code: 'INVALID_SIGNATURE' });
//         }
//       }


//       // Ensure equal length before comparing
//       // const expectedBuf = Buffer.from(expected);
//       // const receivedBuf = Buffer.from(signature);
      
//       // Compare signatures using timing-safe comparison
//       // const isValid = crypto.timingSafeEqual(
//       //   expectedBuf,
//       //  receivedBuf
//       // );

//       // logger.info("Signature Recieved: ", expectedBuf);
//       // logger.info("Expected Signature: ", receivedBuf);

//       // if (expectedBuf.length !== receivedBuf.length || !isValid) {
//       //   logger.warn('Invalid webhook signature', {
//       //     ip: req.ip,
//       //     userAgent: req.get('User-Agent'),
//       //     url: req.url,
//       //     method: req.method,
//       //     providedSignature: signature.substring(0, 20) + '...',
//       //     timestamp: new Date().toISOString()
//       //   });
        
//       //   return res.status(401).json({
//       //     error: 'Invalid webhook signature',
//       //     code: 'INVALID_SIGNATURE'
//       //   });
//       // }

//       logger.info('Webhook signature validated successfully', {
//         ip: req.ip,
//         url: req.url,
//         method: req.method,
//         timestamp: new Date().toISOString()
//       });

//       next();
//     } catch (error) {
//       logger.error('Webhook signature validation error', {
//         error: error.message,
//         stack: error.stack,
//         ip: req.ip,
//         url: req.url,
//         method: req.method,
//         timestamp: new Date().toISOString()
//       });
      
//       res.status(500).json({
//         error: 'Signature validation failed',
//         code: 'SIGNATURE_VALIDATION_ERROR'
//       });
//     }
//   };
// };

// ============================================
// 1. FIXED validateWebhookSignature (validation.js)
// ============================================
// const validateWebhookSignature = (secretKey, headerName = 'x-signature-256') => {
//   return (req, res, next) => {
//     const debugInfo = {
//       url: req.url,
//       method: req.method,
//       headerName,
//       timestamp: new Date().toISOString()
//     };

//     try {
//       const signature = req.get(headerName);
      
//       logger.info('🔍 [WEBHOOK-VALIDATION] Starting validation', {
//         ...debugInfo,
//         hasSignature: !!signature,
//         signaturePreview: signature ? `${signature.substring(0, 20)}...` : 'MISSING',
//         bodyType: Buffer.isBuffer(req.body) ? 'Buffer' : typeof req.body,
//         bodyLength: Buffer.isBuffer(req.body) ? req.body.length : JSON.stringify(req.body).length
//       });
      
//       if (!signature) {
//         logger.warn('❌ [WEBHOOK-VALIDATION] Missing signature', debugInfo);
//         return res.status(401).json({
//           error: 'Missing webhook signature',
//           code: 'MISSING_SIGNATURE'
//         });
//       }

//       // Get raw body for signature verification
//       let rawBuffer;
//       if (Buffer.isBuffer(req.body)) {
//         rawBuffer = req.body;
//         logger.info('📦 [WEBHOOK-VALIDATION] Using Buffer body', {
//           ...debugInfo,
//           bufferLength: rawBuffer.length
//         });
//       } else if (req.rawBody && typeof req.rawBody === 'string') {
//         rawBuffer = Buffer.from(req.rawBody, 'utf8');
//         logger.info('📦 [WEBHOOK-VALIDATION] Using rawBody string', {
//           ...debugInfo,
//           rawBodyLength: req.rawBody.length
//         });
//       } else if (typeof req.body === 'string') {
//         rawBuffer = Buffer.from(req.body, 'utf8');
//         logger.info('📦 [WEBHOOK-VALIDATION] Using body string', {
//           ...debugInfo,
//           bodyLength: req.body.length
//         });
//       } else if (req.body && typeof req.body === 'object') {
//         // Last resort - stringify object
//         rawBuffer = Buffer.from(JSON.stringify(req.body), 'utf8');
//         logger.warn('⚠️ [WEBHOOK-VALIDATION] Had to stringify object body', {
//           ...debugInfo,
//           bodyKeys: Object.keys(req.body)
//         });
//       } else {
//         logger.error('❌ [WEBHOOK-VALIDATION] No valid body found', {
//           ...debugInfo,
//           bodyType: typeof req.body,
//           hasRawBody: !!req.rawBody
//         });
//         return res.status(400).json({
//           error: 'Invalid request body',
//           code: 'INVALID_BODY'
//         });
//       }

//       // Calculate expected signature
//       const expectedHex = crypto
//         .createHmac('sha256', secretKey)
//         .update(rawBuffer)
//         .digest('hex');

//       logger.info('🔐 [WEBHOOK-VALIDATION] Signature calculation', {
//         ...debugInfo,
//         expectedHexLength: expectedHex.length,
//         expectedHexPreview: `${expectedHex.substring(0, 20)}...${expectedHex.substring(expectedHex.length - 20)}`,
//         expectedHexFull: expectedHex, // Full hex for debugging
//         rawBufferLength: rawBuffer.length,
//         rawBufferPreview: rawBuffer.toString('utf8').substring(0, 100)
//       });

//       // Handle different signature formats
//       if (headerName === 'x-razorpay-signature') {
//         // Razorpay: plain hex string
//         const receivedHex = signature.startsWith('sha256=') 
//           ? signature.slice(7) 
//           : signature;

//         logger.info('🎯 [WEBHOOK-VALIDATION] Razorpay signature comparison', {
//           ...debugInfo,
//           receivedHexLength: receivedHex.length,
//           receivedHexPreview: `${receivedHex.substring(0, 20)}...${receivedHex.substring(receivedHex.length - 20)}`,
//           receivedHexFull: receivedHex, // Full hex for debugging
//           expectedHexLength: expectedHex.length,
//           lengthsMatch: receivedHex.length === expectedHex.length,
//           hexesMatch: receivedHex === expectedHex // Direct comparison for debugging
//         });

//         if (receivedHex.length !== expectedHex.length) {
//           logger.warn('❌ [WEBHOOK-VALIDATION] Length mismatch', {
//             ...debugInfo,
//             expectedLength: expectedHex.length,
//             receivedLength: receivedHex.length,
//             difference: Math.abs(expectedHex.length - receivedHex.length)
//           });
//           return res.status(401).json({
//             error: 'Invalid webhook signature',
//             code: 'INVALID_SIGNATURE_LENGTH'
//           });
//         }

//         try {
//           const isValid = crypto.timingSafeEqual(
//             Buffer.from(receivedHex, 'hex'),
//             Buffer.from(expectedHex, 'hex')
//           );

//           if (!isValid) {
//             logger.warn('❌ [WEBHOOK-VALIDATION] Signature mismatch', {
//               ...debugInfo,
//               expectedFirst20: expectedHex.substring(0, 20),
//               receivedFirst20: receivedHex.substring(0, 20),
//               expectedLast20: expectedHex.substring(expectedHex.length - 20),
//               receivedLast20: receivedHex.substring(receivedHex.length - 20)
//             });
//             return res.status(401).json({
//               error: 'Invalid webhook signature',
//               code: 'INVALID_SIGNATURE'
//             });
//           }

//           logger.info('✅ [WEBHOOK-VALIDATION] Signature valid!', debugInfo);
          
//           // Store raw buffer for handler to use without re-verification
//           req.rawBodyBuffer = rawBuffer;
//           req.signatureVerified = true;

//           next();
//         } catch (compareError) {
//           logger.error('❌ [WEBHOOK-VALIDATION] Comparison error', {
//             ...debugInfo,
//             error: compareError.message,
//             stack: compareError.stack
//           });
//           return res.status(500).json({
//             error: 'Signature comparison failed',
//             code: 'COMPARISON_ERROR'
//           });
//         }
//       } else {
//         // Other providers: sha256=hex format
//         const expectedWithPrefix = `sha256=${expectedHex}`;
        
//         logger.info('🎯 [WEBHOOK-VALIDATION] Standard signature comparison', {
//           ...debugInfo,
//           receivedLength: signature.length,
//           expectedLength: expectedWithPrefix.length,
//           lengthsMatch: signature.length === expectedWithPrefix.length
//         });

//         if (signature.length !== expectedWithPrefix.length) {
//           logger.warn('❌ [WEBHOOK-VALIDATION] Length mismatch', {
//             ...debugInfo,
//             expectedLength: expectedWithPrefix.length,
//             receivedLength: signature.length
//           });
//           return res.status(401).json({
//             error: 'Invalid webhook signature',
//             code: 'INVALID_SIGNATURE_LENGTH'
//           });
//         }

//         const isValid = crypto.timingSafeEqual(
//           Buffer.from(signature, 'utf8'),
//           Buffer.from(expectedWithPrefix, 'utf8')
//         );

//         if (!isValid) {
//           logger.warn('❌ [WEBHOOK-VALIDATION] Signature mismatch', debugInfo);
//           return res.status(401).json({
//             error: 'Invalid webhook signature',
//             code: 'INVALID_SIGNATURE'
//           });
//         }

//         logger.info('✅ [WEBHOOK-VALIDATION] Signature valid!', debugInfo);
        
//         // Store raw buffer for handler
//         req.rawBodyBuffer = rawBuffer;
//         req.signatureVerified = true;

//         next();
//       }

//     } catch (error) {
//       logger.error('❌ [WEBHOOK-VALIDATION] Validation error', {
//         ...debugInfo,
//         error: error.message,
//         stack: error.stack
//       });
      
//       res.status(500).json({
//         error: 'Signature validation failed',
//         code: 'SIGNATURE_VALIDATION_ERROR',
//         details: error.message
//       });
//     }
//   };
// };

/**
 * Enhanced webhook signature validation middleware with comprehensive debugging
 */
const validateWebhookSignature = (secretKey, headerName = 'x-signature-256') => {
  return (req, res, next) => {
    const debugInfo = {
      url: req.url,
      path: req.path,
      method: req.method,
      headerName,
      timestamp: new Date().toISOString(),
      correlationId: req.correlationId
    };

    try {
      // Step 1: Check if secret key is configured
      if (!secretKey) {
        logger.error('❌ [WEBHOOK-VALIDATION] Secret key not configured', {
          ...debugInfo,
          headerName,
          environmentVariable: headerName === 'x-razorpay-signature' ? 'RAZORPAY_WEBHOOK_SECRET' : 'SECRET_KEY'
        });
        return res.status(500).json({
          error: 'Webhook secret not configured',
          code: 'SECRET_NOT_CONFIGURED'
        });
      }

      // Step 2: Get signature from header
      const signature = req.get(headerName);
      
      logger.info('🔍 [WEBHOOK-VALIDATION] Starting validation', {
        ...debugInfo,
        hasSignature: !!signature,
        signaturePreview: signature ? `${signature.substring(0, 20)}...` : 'MISSING',
        signatureLength: signature ? signature.length : 0,
        bodyType: Buffer.isBuffer(req.body) ? 'Buffer' : typeof req.body,
        bodyLength: Buffer.isBuffer(req.body) ? req.body.length : 
                    (typeof req.body === 'string' ? req.body.length : 
                    (req.body ? JSON.stringify(req.body).length : 0)),
        hasRawBody: !!req.rawBody,
        rawBodyType: typeof req.rawBody
      });
      
      if (!signature) {
        logger.warn('❌ [WEBHOOK-VALIDATION] Missing signature', {
          ...debugInfo,
          availableHeaders: Object.keys(req.headers),
          expectedHeader: headerName
        });
        return res.status(401).json({
          error: 'Missing webhook signature',
          code: 'MISSING_SIGNATURE'
        });
      }

      // Step 3: Get raw body as Buffer
      let rawBuffer;
      
      if (Buffer.isBuffer(req.body)) {
        // ✅ Best case: express.raw() captured it
        rawBuffer = req.body;
        logger.info('📦 [WEBHOOK-VALIDATION] Using Buffer body (BEST CASE)', {
          ...debugInfo,
          bufferLength: rawBuffer.length,
          first100Bytes: rawBuffer.toString('utf8', 0, 100)
        });
      } else if (req.rawBody && Buffer.isBuffer(req.rawBody)) {
        // ✅ Good: Custom capture of raw body
        rawBuffer = req.rawBody;
        logger.info('📦 [WEBHOOK-VALIDATION] Using rawBody Buffer', {
          ...debugInfo,
          bufferLength: rawBuffer.length
        });
      } else if (req.rawBody && typeof req.rawBody === 'string') {
        // ⚠️ Acceptable: String raw body
        rawBuffer = Buffer.from(req.rawBody, 'utf8');
        logger.warn('📦 [WEBHOOK-VALIDATION] Using rawBody string (converted to Buffer)', {
          ...debugInfo,
          stringLength: req.rawBody.length,
          bufferLength: rawBuffer.length
        });
      } else if (typeof req.body === 'string') {
        // ⚠️ Acceptable: String body
        rawBuffer = Buffer.from(req.body, 'utf8');
        logger.warn('📦 [WEBHOOK-VALIDATION] Using body string (converted to Buffer)', {
          ...debugInfo,
          stringLength: req.body.length,
          bufferLength: rawBuffer.length
        });
      } else if (req.body && typeof req.body === 'object') {
        // ❌ WORST CASE: Had to stringify object
        // This is unreliable as key order and formatting may differ
        const jsonString = JSON.stringify(req.body);
        rawBuffer = Buffer.from(jsonString, 'utf8');
        logger.error('⚠️ [WEBHOOK-VALIDATION] Had to stringify object body (UNRELIABLE!)', {
          ...debugInfo,
          bodyKeys: Object.keys(req.body),
          jsonLength: jsonString.length,
          bufferLength: rawBuffer.length,
          warning: 'This may cause signature mismatches due to key ordering'
        });
      } else {
        // ❌ No valid body found
        logger.error('❌ [WEBHOOK-VALIDATION] No valid body found', {
          ...debugInfo,
          bodyType: typeof req.body,
          hasBody: !!req.body,
          hasRawBody: !!req.rawBody,
          bodyValue: req.body
        });
        return res.status(400).json({
          error: 'Invalid request body',
          code: 'INVALID_BODY'
        });
      }

      // Step 4: Calculate expected signature
      const expectedHex = crypto
        .createHmac('sha256', secretKey)
        .update(rawBuffer)
        .digest('hex');

      logger.info('🔐 [WEBHOOK-VALIDATION] Signature calculation complete', {
        ...debugInfo,
        expectedHexLength: expectedHex.length,
        expectedHexPreview: `${expectedHex.substring(0, 20)}...${expectedHex.substring(expectedHex.length - 20)}`,
        expectedHexFull: expectedHex,
        rawBufferLength: rawBuffer.length,
        rawBufferPreview: rawBuffer.toString('utf8').substring(0, 150),
        secretKeyLength: secretKey.length,
        secretKeyPreview: `${secretKey.substring(0, 5)}...${secretKey.substring(secretKey.length - 5)}`
      });

      // Step 5: Compare signatures based on provider
      if (headerName === 'x-razorpay-signature') {
        // Razorpay sends plain hex string (no prefix)
        const receivedHex = signature.startsWith('sha256=') 
          ? signature.slice(7) 
          : signature;

        logger.info('🎯 [WEBHOOK-VALIDATION] Razorpay signature comparison', {
          ...debugInfo,
          receivedHexLength: receivedHex.length,
          receivedHexPreview: `${receivedHex.substring(0, 20)}...${receivedHex.substring(receivedHex.length - 20)}`,
          receivedHexFull: receivedHex,
          expectedHexLength: expectedHex.length,
          lengthsMatch: receivedHex.length === expectedHex.length,
          hexesMatch: receivedHex === expectedHex,
          caseSensitive: true
        });

        if (receivedHex.length !== expectedHex.length) {
          logger.warn('❌ [WEBHOOK-VALIDATION] Length mismatch', {
            ...debugInfo,
            expectedLength: expectedHex.length,
            receivedLength: receivedHex.length,
            difference: Math.abs(expectedHex.length - receivedHex.length),
            expectedHex: expectedHex,
            receivedHex: receivedHex
          });
          return res.status(401).json({
            error: 'Invalid webhook signature',
            code: 'INVALID_SIGNATURE_LENGTH'
          });
        }

        try {
          const isValid = crypto.timingSafeEqual(
            Buffer.from(receivedHex, 'hex'),
            Buffer.from(expectedHex, 'hex')
          );

          if (!isValid) {
            logger.warn('❌ [WEBHOOK-VALIDATION] Signature mismatch', {
              ...debugInfo,
              expected: expectedHex,
              received: receivedHex,
              expectedFirst20: expectedHex.substring(0, 20),
              receivedFirst20: receivedHex.substring(0, 20),
              expectedLast20: expectedHex.substring(expectedHex.length - 20),
              receivedLast20: receivedHex.substring(receivedHex.length - 20),
              mismatchPositions: findMismatchPositions(expectedHex, receivedHex)
            });
            return res.status(401).json({
              error: 'Invalid webhook signature',
              code: 'INVALID_SIGNATURE'
            });
          }

          logger.info('✅ [WEBHOOK-VALIDATION] Signature valid!', {
            ...debugInfo,
            provider: 'Razorpay',
            signatureLength: receivedHex.length
          });

        } catch (compareError) {
          logger.error('❌ [WEBHOOK-VALIDATION] Comparison error', {
            ...debugInfo,
            error: compareError.message,
            stack: compareError.stack,
            expectedHex,
            receivedHex
          });
          return res.status(500).json({
            error: 'Signature comparison failed',
            code: 'COMPARISON_ERROR'
          });
        }
      } else {
        // Other providers: expect "sha256=..." format
        const expectedWithPrefix = `sha256=${expectedHex}`;
        
        logger.info('🎯 [WEBHOOK-VALIDATION] Standard signature comparison', {
          ...debugInfo,
          provider: headerName,
          receivedLength: signature.length,
          receivedPreview: signature.substring(0, 30) + '...',
          expectedLength: expectedWithPrefix.length,
          expectedPreview: expectedWithPrefix.substring(0, 30) + '...',
          lengthsMatch: signature.length === expectedWithPrefix.length
        });

        if (signature.length !== expectedWithPrefix.length) {
          logger.warn('❌ [WEBHOOK-VALIDATION] Length mismatch', {
            ...debugInfo,
            expectedLength: expectedWithPrefix.length,
            receivedLength: signature.length,
            difference: Math.abs(expectedWithPrefix.length - signature.length)
          });
          return res.status(401).json({
            error: 'Invalid webhook signature',
            code: 'INVALID_SIGNATURE_LENGTH'
          });
        }

        const isValid = crypto.timingSafeEqual(
          Buffer.from(signature, 'utf8'),
          Buffer.from(expectedWithPrefix, 'utf8')
        );

        if (!isValid) {
          logger.warn('❌ [WEBHOOK-VALIDATION] Signature mismatch', {
            ...debugInfo,
            expected: expectedWithPrefix,
            received: signature
          });
          return res.status(401).json({
            error: 'Invalid webhook signature',
            code: 'INVALID_SIGNATURE'
          });
        }

        logger.info('✅ [WEBHOOK-VALIDATION] Signature valid!', {
          ...debugInfo,
          provider: headerName
        });
      }

      // Step 6: Store raw buffer and verification flag for handler
      req.rawBodyBuffer = rawBuffer;
      req.signatureVerified = true;

      logger.info('✅ [WEBHOOK-VALIDATION] Validation complete, proceeding to handler', {
        ...debugInfo,
        rawBodyBufferLength: rawBuffer.length,
        signatureVerified: true
      });

      next();

    } catch (error) {
      logger.error('❌ [WEBHOOK-VALIDATION] Validation error', {
        ...debugInfo,
        error: error.message,
        stack: error.stack,
        errorName: error.name,
        errorCode: error.code
      });
      
      res.status(500).json({
        error: 'Signature validation failed',
        code: 'SIGNATURE_VALIDATION_ERROR',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  };
};

/**
 * Helper function to find mismatch positions between two hex strings
 */
function findMismatchPositions(expected, received) {
  if (expected.length !== received.length) {
    return { error: 'Different lengths', expectedLength: expected.length, receivedLength: received.length };
  }

  const mismatches = [];
  for (let i = 0; i < expected.length && mismatches.length < 10; i++) {
    if (expected[i] !== received[i]) {
      mismatches.push({
        position: i,
        expected: expected[i],
        received: received[i],
        context: `...${expected.substring(Math.max(0, i - 5), Math.min(expected.length, i + 6))}...`
      });
    }
  }

  return mismatches.length > 0 ? mismatches : 'No mismatches found';
}
/**
 * Specific webhook signature validators for different services
 */
const webhookValidators = {
  auth0: validateWebhookSignature(process.env.AUTH0_WEBHOOK_SECRET, 'x-auth0-signature'),
  razorpay: validateWebhookSignature(process.env.RAZORPAY_WEBHOOK_SECRET, 'x-razorpay-signature'),
  openai: validateWebhookSignature(process.env.OPENAI_WEBHOOK_SECRET, 'x-openai-signature'),
  ideogram: validateWebhookSignature(process.env.IDEOGRAM_WEBHOOK_SECRET, 'x-ideogram-signature'),
  slack: validateWebhookSignature(process.env.SLACK_WEBHOOK_SECRET, 'x-slack-signature')
};

/**
 * HTTP Parameter Pollution (HPP) protection
 */
const hppProtection = hpp({
  whitelist: ['tags', 'categories', 'types', 'filters'] // Allow arrays for these parameters
});

/**
 * Request size validation middleware
 */
const validateRequestSize = (maxSize = '10mb') => {
  return (req, res, next) => {
    const contentLength = req.get('content-length');
    
    if (contentLength) {
      const sizeInBytes = parseInt(contentLength);
      const maxSizeInBytes = parseSize(maxSize);
      
      if (sizeInBytes > maxSizeInBytes) {
        logger.warn('Request size exceeded', {
          ip: req.ip,
          userAgent: req.get('User-Agent'),
          url: req.url,
          method: req.method,
          contentLength: sizeInBytes,
          maxSize: maxSizeInBytes,
          timestamp: new Date().toISOString()
        });
        
        return res.status(413).json({
          error: 'Request entity too large',
          maxSize: maxSize,
          receivedSize: `${Math.round(sizeInBytes / 1024 / 1024 * 100) / 100}MB`
        });
      }
    }
    
    next();
  };
};

/**
 * Parse size string to bytes
 */
function parseSize(size) {
  const units = {
    'b': 1,
    'kb': 1024,
    'mb': 1024 * 1024,
    'gb': 1024 * 1024 * 1024
  };
  
  const match = size.toString().toLowerCase().match(/^(\d+(?:\.\d+)?)\s*([kmg]?b)$/);
  
  if (!match) {
    throw new Error(`Invalid size format: ${size}`);
  }
  
  const [, number, unit] = match;
  return parseFloat(number) * units[unit];
}

/**
 * Security headers middleware (additional to helmet)
 */
const securityHeaders = (req, res, next) => {
  // Additional security headers not covered by helmet
  res.setHeader('X-Request-ID', req.id || crypto.randomUUID());
  res.setHeader('X-Response-Time', Date.now());
  
  // Custom security headers for API
  res.setHeader('X-API-Version', '1.0.0');
  res.setHeader('X-Rate-Limit-Policy', 'standard');
  
  // Remove server information
  res.removeHeader('X-Powered-By');
  
  next();
};

/**
 * IP whitelist/blacklist middleware
 */
const ipFilter = (options = {}) => {
  const { whitelist = [], blacklist = [], trustProxy = true } = options;
  
  return (req, res, next) => {
    const clientIP = trustProxy ? 
      req.get('x-forwarded-for')?.split(',')[0]?.trim() || req.ip : 
      req.connection.remoteAddress;
    
    // Check blacklist first
    if (blacklist.length > 0 && blacklist.includes(clientIP)) {
      logger.warn('Blocked IP attempt', {
        ip: clientIP,
        userAgent: req.get('User-Agent'),
        url: req.url,
        method: req.method,
        reason: 'blacklisted',
        timestamp: new Date().toISOString()
      });
      
      return res.status(403).json({
        error: 'Access denied',
        code: 'IP_BLOCKED'
      });
    }
    
    // Check whitelist if configured
    if (whitelist.length > 0 && !whitelist.includes(clientIP)) {
      logger.warn('Non-whitelisted IP attempt', {
        ip: clientIP,
        userAgent: req.get('User-Agent'),
        url: req.url,
        method: req.method,
        reason: 'not_whitelisted',
        timestamp: new Date().toISOString()
      });
      
      return res.status(403).json({
        error: 'Access denied',
        code: 'IP_NOT_WHITELISTED'
      });
    }
    
    next();
  };
};

/**
 * Request correlation ID middleware
 */
const correlationId = (req, res, next) => {
  // Prefer the X-Request-ID that ingress-nginx generates and writes to its own
  // access log, so one request can be followed from the ingress into app logs.
  const correlationId = req.get('x-correlation-id') || req.get('x-request-id') || crypto.randomUUID();
  req.correlationId = correlationId;
  res.setHeader('x-correlation-id', correlationId);
  next();
};

/**
 * Audit logging middleware for sensitive operations
 */
const auditLog = (operation) => {
  return (req, res, next) => {
    const startTime = Date.now();
    
    // Log request
    logger.info('Audit log - Request', {
      operation,
      correlationId: req.correlationId,
      userId: req.user?.sub,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      url: req.url,
      method: req.method,
      timestamp: new Date().toISOString(),
      requestBody: sanitizeForAudit(req.body)
    });
    
    // Override res.json to log response
    const originalJson = res.json;
    res.json = function(data) {
      const duration = Date.now() - startTime;
      
      logger.info('Audit log - Response', {
        operation,
        correlationId: req.correlationId,
        userId: req.user?.sub,
        statusCode: res.statusCode,
        duration,
        timestamp: new Date().toISOString(),
        responseData: sanitizeForAudit(data)
      });
      
      return originalJson.call(this, data);
    };
    
    next();
  };
};

/**
 * Sanitize data for audit logging
 */
function sanitizeForAudit(data) {


  // ✅ Handle Buffers explicitly (prevents numeric-index dumps)
  if (Buffer.isBuffer(data)) {
    try {
      const str = data.toString('utf8');
      return JSON.parse(str);
    } catch {
      return { _raw: data.toString('base64') }; // safe, readable fallback
    }
  }


  if (!data || typeof data !== 'object') {
    return data;
  }
  
  const sensitiveFields = [
    'password', 'token', 'secret', 'key', 'authorization',
    'credit_card', 'ssn', 'social_security', 'api_key',
    'access_token', 'refresh_token', 'webhook_secret'
  ];
  
  // const sanitized = JSON.parse(JSON.stringify(data));
  
  function recursiveSanitize(obj) {
    if (Array.isArray(obj)) {
      return obj.map(recursiveSanitize);
    }
    
    if (obj && typeof obj === 'object') {
      const result = {};
      for (const [key, value] of Object.entries(obj)) {
        if (sensitiveFields.some(field => key.toLowerCase().includes(field))) {
          result[key] = '[REDACTED]';
        } else {
          result[key] = recursiveSanitize(value);
        }
      }
      return result;
    }
    
    return obj;
  }
  
  try {
    return recursiveSanitize(data);
  } catch (err) {
    console.error('sanitizeForAudit error:', err);
    return '[UNSERIALIZABLE_DATA]';
  }
}

/**
 * Content Security Policy for API responses
 */
const contentSecurityPolicy = (req, res, next) => {
  res.setHeader('Content-Security-Policy', 
    "default-src 'none'; " +
    "script-src 'none'; " +
    "style-src 'none'; " +
    "img-src 'none'; " +
    "connect-src 'self'; " +
    "font-src 'none'; " +
    "object-src 'none'; " +
    "media-src 'none'; " +
    "frame-src 'none';"
  );
  next();
};

module.exports = {
  rateLimitConfigs,
  createRateLimit,
  createSlowDown,
  validateWebhookSignature,
  webhookValidators,
  hppProtection,
  validateRequestSize,
  securityHeaders,
  ipFilter,
  correlationId,
  auditLog,
  contentSecurityPolicy
};