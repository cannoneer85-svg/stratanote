import { pipeline } from '@xenova/transformers';

let extractor = null;

/**
 * Lazy initialization of the feature-extraction pipeline.
 */
export async function getExtractor() {
  if (!extractor) {
    console.log('[Embeddings] Loading Xenova paraphrase-multilingual-MiniLM-L12-v2 model...');
    extractor = await pipeline('feature-extraction', 'Xenova/paraphrase-multilingual-MiniLM-L12-v2');
    console.log('[Embeddings] Model loaded successfully.');
  }
  return extractor;
}

/**
 * Clean markdown formatting and generate a vector embedding for a given text.
 * @param {string} text - Raw markdown text
 * @returns {Promise<number[]>} - Float array representing the semantic vector (length 384)
 */
export async function getEmbedding(text) {
  if (!text || typeof text !== 'string') {
    return new Array(384).fill(0);
  }

  // Clean markdown layout to keep only semantic text content
  const cleanText = text
    .replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, '$1') // [[wiki links]] -> wiki links
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')         // [links](url) -> links
    .replace(/[#*`_~]/g, '')                         // remove markdown symbols
    .replace(/\s+/g, ' ')                            // collapse whitespace
    .trim();

  if (cleanText.length === 0) {
    return new Array(384).fill(0);
  }

  try {
    const extractorInstance = await getExtractor();
    // Use mean pooling and L2 normalization (output vector will be unit normalized)
    const output = await extractorInstance(cleanText, { pooling: 'mean', normalize: true });
    
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
