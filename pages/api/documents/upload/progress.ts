import { NextApiRequest, NextApiResponse } from 'next';

interface ProgressData {
  current: number;
  total: number;
  message: string;
  stage: string;
}

// Store progress for each file
const progressMap = new Map<string, ProgressData>();

export async function updateProgress(
  fileName: string,
  current: number,
  total: number,
  message: string,
  stage: string
) {
  console.log(`[PROGRESS] Updating progress for ${fileName}:`, { current, total, message, stage });
  const progressData = { current, total, message, stage };
  progressMap.set(fileName, progressData);
  
  // If this is a complete or error state, ensure we keep it in the map
  if (stage === 'complete' || stage === 'error') {
    // Keep the final state for 5 seconds before cleaning up
    setTimeout(() => {
      if (progressMap.get(fileName)?.stage === stage) {
        progressMap.delete(fileName);
      }
    }, 5000);
  }
}

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.status(405).json({ message: 'Method not allowed' });
    return;
  }

  const fileName = req.query.file as string;
  if (!fileName) {
    res.status(400).json({ message: 'File name is required' });
    return;
  }

  console.log(`[PROGRESS] Setting up SSE for ${fileName}`);

  // Set headers for SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');

  // Send initial progress if available
  const initialProgress = progressMap.get(fileName);
  if (initialProgress) {
    console.log(`[PROGRESS] Sending initial progress for ${fileName}:`, initialProgress);
    res.write(`data: ${JSON.stringify(initialProgress)}\n\n`);
  } else {
    // Send initial state if no progress yet
    const initialState: ProgressData = {
      current: 0,
      total: 100,
      message: 'Starting upload...',
      stage: 'uploading'
    };
    console.log(`[PROGRESS] Sending initial state for ${fileName}:`, initialState);
    res.write(`data: ${JSON.stringify(initialState)}\n\n`);
  }

  let lastProgress: ProgressData | null = null;
  let lastUpdateTime = Date.now();

  // Set up interval to send progress updates
  const interval = setInterval(() => {
    const progress = progressMap.get(fileName);
    const now = Date.now();
    
    if (progress) {
      // Only send update if progress has changed or it's been more than 100ms
      if (!lastProgress || 
          lastProgress.current !== progress.current || 
          lastProgress.stage !== progress.stage ||
          lastProgress.message !== progress.message ||
          now - lastUpdateTime >= 100) {
        console.log(`[PROGRESS] Sending update for ${fileName}:`, progress);
        res.write(`data: ${JSON.stringify(progress)}\n\n`);
        lastProgress = progress;
        lastUpdateTime = now;
      }
      
      // Stop sending updates if the stage is complete or error
      if (progress.stage === 'complete' || progress.stage === 'error') {
        console.log(`[PROGRESS] Stopping updates for ${fileName} - stage: ${progress.stage}`);
        clearInterval(interval);
        // Send one final update before ending
        res.write(`data: ${JSON.stringify(progress)}\n\n`);
        res.end();
      }
    }
  }, 50); // Send updates more frequently

  // Clean up on client disconnect
  req.on('close', () => {
    console.log(`[PROGRESS] Client disconnected for ${fileName}`);
    clearInterval(interval);
  });
} 