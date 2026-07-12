import { pipeline, env } from '@xenova/transformers';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Configure local cache directory so it is writable on all hosting platforms (like Railway)
env.cacheDir = join(__dirname, '.cache');

let extractorPromise = null;

/**
 * Lazy initialization of the feature-extraction pipeline.
 */
export async function getExtractor() {
  if (!extractorPromise) {
    console.log('[Embeddings] Loading Xenova paraphrase-multilingual-MiniLM-L12-v2 model...');
    extractorPromise = pipeline('feature-extraction', 'Xenova/paraphrase-multilingual-MiniLM-L12-v2')
      .then(instance => {
        console.log('[Embeddings] Model loaded successfully.');
        return instance;
      })
      .catch(err => {
        console.error('[Embeddings] Failed to load model:', err);
        extractorPromise = null; // Reset to allow retry
        throw err;
      });
  }
  return extractorPromise;
}

/**
 * Clean markdown formatting and generate a vector embedding for a given text.
 * @param {string} text - Raw markdown text
 * @returns {Promise<number[]>} - Float array representing the semantic vector (length 384)
 */
export async function getEmbedding(text, relPath = '') {
  if (!text || typeof text !== 'string') {
    return new Array(384).fill(0);
  }

  // If calculating for a note document, ignore test directories
  if (relPath) {
    const normalizedPath = relPath.toLowerCase().replace(/\\/g, '/');
    if (normalizedPath.startsWith('test/') || normalizedPath.includes('/test/')) {
      // Exclude test notes from semantic index
      return new Array(384).fill(0);
    }
  }

  // Clean markdown layout to keep only semantic text content
  let cleanText = text
    .replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, '$1') // [[wiki links]] -> wiki links
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')         // [links](url) -> links
    .replace(/[#*`_~]/g, '')                         // remove markdown symbols
    .replace(/\s+/g, ' ')                            // collapse whitespace
    .trim();

  // If calculating for a note document, ignore the title itself to verify content length
  const title = relPath ? relPath.split('/').pop().replace('.md', '') : '';
  if (relPath && title) {
    const titleRegex = new RegExp(title.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'), 'gi');
    const contentWithoutTitle = cleanText.replace(titleRegex, '').trim();
    if (contentWithoutTitle.length < 20) {
      // Document content is too short/empty to be semantically indexed
      return new Array(384).fill(0);
    }
  }

  if (cleanText.length === 0) {
    return new Array(384).fill(0);
  }

  // Compose text to embed: prepend title for stronger alignment in search
  let textToEmbed = cleanText;
  if (relPath && title) {
    textToEmbed = `Title: ${title}. Content: ${cleanText.slice(0, 1200)}`;
  } else {
    textToEmbed = cleanText.slice(0, 1200);
  }

  try {
    const extractorInstance = await getExtractor();
    // Use mean pooling and L2 normalization (output vector will be unit normalized)
    const output = await extractorInstance(textToEmbed, { pooling: 'mean', normalize: true });
    
    // Extract Float32Array from the output tensor data
    return Array.from(output.data);
  } catch (err) {
    console.error('[Embeddings] Failed to calculate embedding:', err);
    return new Array(384).fill(0);
  }
}

/**
 * Calculate cosine similarity between two numeric vectors.
 * Since the vectors are L2-normalized during generation, 
 * this is simply the dot product.
 * @param {number[]} vecA
 * @param {number[]} vecB
 * @returns {number} similarity score (between -1 and 1)
 */
export function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
  
  let dotProduct = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
  }
  return dotProduct;
}
