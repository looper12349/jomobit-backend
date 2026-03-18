# Quick Start Guide - New Poster Generation System

## 🚀 What Changed?

The poster generation system now supports **three distinct flows** based on `posterType`:
- **wish** - Festive greeting posters
- **awareness** - Brand storytelling posters  
- **cta** - Call-to-action promotional posters

---

## 📁 New File Structure

```
src/
├── config/
│   └── llmModels.js                    ← NEW: LLM configurations
├── models/
│   ├── PosterConcept.js                ← NEW: Concept storage
│   └── BusinessProfile.js              ← UPDATED: Added niche field
├── services/
│   ├── llm/                            ← NEW: LLM operations
│   │   ├── llmService.js
│   │   ├── nicheDetector.js
│   │   ├── templateExtractor.js
│   │   └── conceptGenerator.js
│   ├── embedding/                      ← NEW: Embedding operations
│   │   ├── embeddingService.js
│   │   └── semanticMatcher.js
│   └── posterGeneration/               ← NEW: Poster generators
│       ├── index.js
│       ├── baseGenerator.js
│       ├── wishingGenerator.js
│       ├── awarenessGenerator.js
│       └── ctaGenerator.js
```

---

## 🔄 How It Works Now

### **Old Flow (Simple)**
```
Request → Validate → Generate Prompt → Generate Image → Done
```

### **New Flow (Poster-Type Specific)**
```
Request → Validate → Route to Generator → Execute Flow → Done
                           ↓
                    ┌──────┴──────┐
                    │             │
              Wishing    Awareness    CTA
                │           │          │
            Type A/B    Concepts   Multi-stage
```

---

## 🎯 Key Changes

### **1. Niche Auto-Detection**
If `BusinessProfile.niche` is missing, it's automatically detected and saved:
```javascript
// Happens automatically at job start
const niche = await nicheDetector.ensureNiche(profile);
// Result: 'fashion', 'jewellery', 'electronics', etc.
```

### **2. Template Metadata Extraction**
Template images are analyzed once to extract structured metadata:
```javascript
const metadata = await templateExtractor.extractMetadata(template);
// Returns: festival, colors, layout, typography, etc.
```

### **3. Concept Generation (Awareness & CTA)**
Multiple concepts are generated and the best one is selected:
```javascript
// Generate 5 concepts
const concepts = await conceptGenerator.generateConcepts(...);

// Select best using semantic matching
const selected = await semanticMatcher.selectBestConcept(concepts, brandDNA);

// Store in database
await PosterConcept.create({ jobId, selectedConcept, rejectedConcepts });
```

### **4. Multi-Stage Generation (CTA Only)**
Model and product images are generated separately:
```javascript
// Generate model image
const modelImage = await generateModelImage(...);
// → Uploaded to ImageKit: assets/model/

// Generate product image  
const productImage = await generateProductImage(...);
// → Uploaded to ImageKit: assets/product/

// Compose final poster
const poster = await generatePoster(modelImage, productImage, ...);
```

---

## 🛠️ Configuration

### **LLM Models** (`src/config/llmModels.js`)
```javascript
const LLM_MODELS = {
  TEMPLATE_METADATA_EXTRACTION: {
    provider: 'openai',
    model: 'gpt-4o',
    temperature: 0.3,
    maxTokens: 2000
  },
  NICHE_DETECTION: {
    provider: 'openai',
    model: 'gpt-4o-mini',
    temperature: 0.2,
    maxTokens: 50
  },
  // ... more configurations
};
```

**To change a model:** Just update the config file, no code changes needed!

### **Supported Niches**
```javascript
const SUPPORTED_NICHES = [
  'fashion',
  'accessories', 
  'electronics',
  'wearables',
  'food_gourmet',
  'sports',
  'jewellery'
];
```

### **Retry Configuration**
```javascript
const RETRY_CONFIG = {
  nicheDetection: 1,      // Retry once
  conceptGeneration: 2,   // Retry twice
  imageGeneration: 1      // Retry once
};
```

---

## 📊 Database Changes

### **New Collection: `posterconcepts`**
Stores generated concepts with embeddings:
```javascript
{
  jobId: ObjectId,
  posterType: 'awareness',
  selectedConcept: {
    concept: "...",
    score: 0.87,
    embedding: [0.123, -0.456, ...]
  },
  rejectedConcepts: [...]
}
```

### **Updated Collection: `businessprofiles`**
Added niche field:
```javascript
{
  // ... existing fields
  niche: 'fashion'  // Auto-detected or manually set
}
```

---

## 🧪 Testing

### **Test Wishing Poster**
```bash
POST /api/posters/generate
{
  "profileId": "...",
  "templateId": "...",
  "posterType": "wish",
  "aiProvider": { "llm": "openai", "diffusion": "openai" }
}
```

### **Test Awareness Poster**
```bash
POST /api/posters/generate
{
  "profileId": "...",
  "templateId": "...",
  "posterType": "awareness",
  "aiProvider": { "llm": "openai", "diffusion": "openai" }
}
```

### **Test CTA Poster**
```bash
POST /api/posters/generate
{
  "profileId": "...",
  "templateId": "...",
  "posterType": "cta",
  "aiProvider": { "llm": "openai", "diffusion": "openai" }
}
```

---

## 🐛 Debugging

### **Check Logs**
All operations are logged with structured data:
```javascript
logger.info('Processing generation job', { jobId, posterType });
logger.info('Niche detected', { profileId, niche });
logger.info('Concepts generated', { count: 5 });
logger.info('Best concept selected', { score: 0.87 });
```

### **Check Database**
```javascript
// Check if niche was detected
db.businessprofiles.findOne({ _id: profileId })

// Check stored concepts
db.posterconcepts.find({ jobId: jobId })

// Check job status
db.generationjobs.findOne({ _id: jobId })
```

### **Common Issues**

**Issue:** Niche detection fails
```
Solution: Check if profile has name, tagline, description, products
Fallback: System uses 'other' and proceeds without fine-tuning
```

**Issue:** Concept generation fails
```
Solution: Check LLM API key and quota
Retry: Automatically retries 2 times
```

**Issue:** CTA model/product image fails
```
Solution: Check diffusion provider API
Fallback: Uses description instead of image
```

---

## 📈 Performance

### **Processing Times**
- **Wishing:** 10-25 seconds
- **Awareness:** 20-30 seconds  
- **CTA:** 60-90 seconds (multi-stage)

### **API Costs (Approximate)**
- **Wishing:** $0.05 - $0.10 per poster
- **Awareness:** $0.10 - $0.15 per poster
- **CTA:** $0.20 - $0.30 per poster (3 diffusion calls)

---

## 🔧 Maintenance

### **Update LLM Model**
Edit `src/config/llmModels.js`:
```javascript
CONCEPT_GENERATION: {
  model: 'gpt-4o',  // Change to 'gpt-4' or 'gpt-4o-mini'
  temperature: 0.8
}
```

### **Add New Niche**
1. Add to `SUPPORTED_NICHES` in `src/config/llmModels.js`
2. Add fine-tuning in `conceptGenerator.js` → `getNicheFinetuning()`
3. Add enhancements in `ctaGenerator.js` → `enhancePromptWithNiche()`

### **Add New Poster Type**
1. Create new generator in `src/services/posterGeneration/`
2. Extend `BasePosterGenerator`
3. Register in `src/services/posterGeneration/index.js`

---

## ✅ Checklist

Before going to production:
- [ ] Test all three poster types
- [ ] Verify niche auto-detection works
- [ ] Check concept storage in database
- [ ] Monitor API costs
- [ ] Test error handling and retries
- [ ] Verify ImageKit uploads (CTA)
- [ ] Check logs for debugging
- [ ] Test with different niches
- [ ] Verify template metadata extraction
- [ ] Test semantic matching

---

## 🆘 Support

**Questions?**
- Check `IMPLEMENTATION_COMPLETE.md` for detailed documentation
- Review code comments (JSDoc)
- Check logs for debugging info

**Issues?**
- Verify API keys (OpenAI, ImageKit)
- Check database connections
- Review error logs
- Test with simpler cases first

---

**Ready to go! 🚀**
