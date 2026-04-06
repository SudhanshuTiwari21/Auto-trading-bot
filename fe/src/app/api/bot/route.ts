import { NextRequest, NextResponse } from 'next/server';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import jwt from 'jsonwebtoken';

// Use environment variable for JWT secret
const JWT_SECRET = process.env.NEXT_PUBLIC_JWT_SECRET || 'your-secret-key-for-trading-bot-authentication';

// Define type for decoded JWT token
interface DecodedToken {
  username: string;
  iat: number;
  exp: number;
}

// Helper function to verify JWT token
const verifyToken = (token: string): DecodedToken | null => {
  try {
    return jwt.verify(token, JWT_SECRET) as DecodedToken;
  } catch (error) {
    console.log(error);
    return null;
  }
};

// Helper function to check authentication
const checkAuth = (request: NextRequest): boolean => {
  // For browser requests, check Authorization header
  const authHeader = request.headers.get('Authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    const decoded = verifyToken(token);
    if (decoded) {
      return true;
    }
  }
  
  // For API requests from the frontend, check the token in the request body
  return false;
};

// Define type for bot process
interface BotProcess {
  process: ChildProcess | null;
  running: boolean;
}

// Store bot process IDs
const botProcesses: Record<string, BotProcess> = {
  azbit: { process: null, running: false },
  p2pb2b: { process: null, running: false }
};

// Define type for request body
interface BotActionRequest {
  action: 'start' | 'stop';
  botId: 'azbit' | 'p2pb2b';
}

export async function POST(request: NextRequest) {
  try {
    // Check authentication
    if (!checkAuth(request)) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    
    const requestBody = await request.json() as Partial<BotActionRequest>;
    const { action, botId } = requestBody;

    if (!botId || !['azbit', 'p2pb2b'].includes(botId)) {
      return NextResponse.json({ success: false, error: 'Invalid bot ID' }, { status: 400 });
    }

    if (!action || !['start', 'stop'̦̦̦̦].includes(action)) {
      return NextResponse.json({ success: false, error: 'Invalid action' }, { status: 400 });
    }

    // Get the root directory (outside of /fe)
    const rootDir = process.cwd().replace(/\\fe$/, '');

    if (action === 'start') {
      // Check if bot is already running
      if (botProcesses[botId].running) {
        return NextResponse.json({ success: false, error: 'Bot is already running' }, { status: 400 });
      }

      // Determine which script to run based on botId
      const scriptPath = botId === 'azbit' ? 'index.js' : 'p2pb2b-random-quantity-improved.js';
      const fullScriptPath = path.join(rootDir, scriptPath);


      // Check if the script exists
      if (!fs.existsSync(fullScriptPath)) {
        return NextResponse.json({ 
          success: false, 
          error: `Script ${scriptPath} not found` 
        }, { status: 404 });
      }

      try {
        // Start the bot process detached so it continues running after the API request completes
        const childProcess = spawn('node', [scriptPath], {
          cwd: rootDir,
          detached: true,
          stdio: 'ignore',
          windowsHide: true
        });

        // Unref the process to allow the Node.js event loop to exit even if the process is still running
        childProcess.unref();

        // Store the process reference
        botProcesses[botId] = {
          process: childProcess,
          running: true
        };

        // Create a marker file to indicate the bot is running
        fs.writeFileSync(path.join(rootDir, `${botId}-running.txt`), 'running');

        return NextResponse.json({ 
          success: true, 
          message: `${botId} bot started successfully`,
          pid: childProcess.pid
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error(`Error starting ${botId} bot:`, error);
        return NextResponse.json({ 
          success: false, 
          error: `Failed to start ${botId} bot: ${errorMessage}`
        }, { status: 500 });
      }
    } else if (action === 'stop') {
      // Check if bot is running based on marker file
      const markerFile = path.join(rootDir, `${botId}-running.txt`);
      const isRunning = fs.existsSync(markerFile);

      if (!isRunning) {
        return NextResponse.json({ success: false, error: 'Bot is not running' }, { status: 400 });
      }

      try {
        // If we have a process reference, try to kill it
        if (botProcesses[botId].process && botProcesses[botId].process.pid) {
          // On Windows, we need to use taskkill to kill the process tree
          if (process.platform === 'win32') {
            spawn('taskkill', ['/pid', botProcesses[botId].process.pid.toString(), '/f', '/t']);
          } else {
            process.kill(-botProcesses[botId].process.pid); // Negative PID kills the process group
          }
        }

        // Remove the marker file
        fs.unlinkSync(markerFile);

        // Update the process status
        botProcesses[botId] = {
          process: null,
          running: false
        };

        return NextResponse.json({ 
          success: true, 
          message: `${botId} bot stopped successfully` 
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error(`Error stopping ${botId} bot:`, error);
        
        // Even if there's an error, try to remove the marker file and update status
        try {
          if (fs.existsSync(markerFile)) {
            fs.unlinkSync(markerFile);
          }
          botProcesses[botId].running = false;
        } catch (e) {
          console.error('Error cleaning up after failed stop:', e);
        }

        return NextResponse.json({ 
          success: false, 
          error: `Failed to stop ${botId} bot: ${errorMessage}`
        }, { status: 500 });
      }
    }

    return NextResponse.json({ success: false, error: 'Invalid request' }, { status: 400 });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error handling bot action:', error);
    return NextResponse.json({ 
      success: false, 
      error: errorMessage
    }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    // Check authentication
    if (!checkAuth(request)) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    
    const url = new URL(request.url);
    const botId = url.searchParams.get('botId');
    
    if (!botId || !['azbit', 'p2pb2b'].includes(botId)) {
      return NextResponse.json({ success: false, error: 'Invalid bot ID' }, { status: 400 });
    }
    
    // Check if the marker file exists to determine if the bot is running
    const rootDir = process.cwd().replace(/\\fe$/, '');
    const markerFile = path.join(rootDir, `${botId}-running.txt`);
    const isRunning = fs.existsSync(markerFile);
    
    // Update our in-memory state to match the file system
    botProcesses[botId].running = isRunning;
    
    return NextResponse.json({ 
      success: true, 
      data: {
        running: isRunning
      }
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error getting bot status:', error);
    return NextResponse.json({ 
      success: false, 
      error: errorMessage
    }, { status: 500 });
  }
}
