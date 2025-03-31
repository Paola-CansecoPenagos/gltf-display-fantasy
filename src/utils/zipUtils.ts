
import JSZip from 'jszip';
import { toast } from '@/hooks/use-toast';
import * as THREE from 'three';

export interface ExtractedFile {
  name: string;
  path: string;
  url: URL;
  isGltf: boolean;
  data?: ArrayBuffer;
}

export async function extractZipFile(file: File): Promise<ExtractedFile[] | null> {
  try {
    const zipInstance = new JSZip();
    const zipContent = await zipInstance.loadAsync(file);
    const extractedFiles: ExtractedFile[] = [];
    
    // Store base directories
    const directories = new Set<string>();
    Object.keys(zipContent.files).forEach(path => {
      const pathParts = path.split('/');
      if (pathParts.length > 1) {
        directories.add(pathParts[0]);
      }
    });
    
    // Process all files
    const filePromises = Object.keys(zipContent.files).map(async (filename) => {
      const zipEntry = zipContent.files[filename];
      
      // Skip directories
      if (zipEntry.dir) return;
      
      try {
        // Convert file to blob and create object URL
        const content = await zipEntry.async('arraybuffer');
        const fileBlob = new Blob([content]);
        const fileUrl = URL.createObjectURL(fileBlob);
        
        // Determine MIME type based on extension
        const extension = filename.split('.').pop()?.toLowerCase();
        let mimeType = 'application/octet-stream';
        
        if (extension === 'gltf') {
          mimeType = 'model/gltf+json';
        } else if (extension === 'glb') {
          mimeType = 'model/gltf-binary';
        } else if (['png', 'jpg', 'jpeg', 'webp'].includes(extension || '')) {
          mimeType = `image/${extension}`;
        } else if (extension === 'bin') {
          mimeType = 'application/octet-stream';
        }
        
        extractedFiles.push({
          name: filename.split('/').pop() || filename,
          path: filename,
          url: new URL(fileUrl),
          isGltf: extension === 'gltf' || extension === 'glb',
          data: content,
        });
      } catch (err) {
        console.error(`Error extracting file ${filename}:`, err);
      }
    });
    
    await Promise.all(filePromises);
    
    // Check if we found any GLTF/GLB files
    const gltfFiles = extractedFiles.filter(f => f.isGltf);
    if (gltfFiles.length === 0) {
      toast({
        title: "Error",
        description: "No se encontraron archivos GLTF o GLB en el ZIP",
        variant: "destructive"
      });
      return null;
    }
    
    return extractedFiles;
  } catch (error) {
    console.error('Error processing ZIP file:', error);
    toast({
      title: "Error",
      description: "Error al procesar el archivo ZIP",
      variant: "destructive"
    });
    return null;
  }
}

// Create a custom loader for Three.js that loads resources from the extracted ZIP
export function createZipResourceLoader(extractedFiles: ExtractedFile[]): (url: string) => Promise<ArrayBuffer | string> {
  // Create a map for faster lookups
  const fileMap = new Map<string, ExtractedFile>();
  
  console.log('Setting up ZIP resource loader with files:', extractedFiles.map(f => f.path));
  
  // Add multiple ways to look up each file
  extractedFiles.forEach(file => {
    // By filename (case insensitive)
    fileMap.set(file.name.toLowerCase(), file);
    
    // By full path (case insensitive)
    fileMap.set(file.path.toLowerCase(), file);
    
    // By path without leading directory
    if (file.path.includes('/')) {
      const pathWithoutDir = file.path.substring(file.path.indexOf('/') + 1);
      fileMap.set(pathWithoutDir.toLowerCase(), file);
    }
    
    // Add by basename only (for buffer files often referenced as just "scene.bin")
    const baseName = file.name.toLowerCase();
    if (!fileMap.has(baseName)) {
      fileMap.set(baseName, file);
    }
  });

  // Store bin files for fallback
  const binFiles = extractedFiles.filter(f => f.name.toLowerCase().endsWith('.bin'));
  console.log('Available bin files:', binFiles.map(f => f.path));
  
  return async (url: string): Promise<ArrayBuffer | string> => {
    // Normalize the URL (remove query parameters, normalize directory separators)
    let normalizedUrl = url.split('?')[0].toLowerCase();
    normalizedUrl = normalizedUrl.replace(/\\/g, '/');
    
    // Extract just the filename without path
    const filename = normalizedUrl.split('/').pop() || normalizedUrl;
    
    console.log(`Looking for: "${normalizedUrl}" or filename: "${filename}"`);
    
    // Try different ways to find the file
    let file = fileMap.get(normalizedUrl) || 
               fileMap.get(filename) || 
               extractedFiles.find(f => f.path.toLowerCase().endsWith(normalizedUrl)) ||
               extractedFiles.find(f => f.path.toLowerCase().endsWith('/' + filename)) ||
               extractedFiles.find(f => f.name.toLowerCase() === filename);
    
    // Special handling for bin files - crucial for scene.bin references
    if (!file && filename.endsWith('.bin')) {
      console.log(`Binary file "${filename}" not found directly, searching for alternatives...`);
      
      // First try to find a bin file with exactly this name (case insensitive)
      file = extractedFiles.find(f => f.name.toLowerCase() === filename.toLowerCase());
      
      // If not found, try to match any bin file by examining the path
      if (!file) {
        // Look for bin files that might match by path segments
        const potentialMatches = binFiles.filter(f => {
          // Check if any part of the path matches parts of the requested URL
          const urlParts = normalizedUrl.split('/');
          const fileParts = f.path.toLowerCase().split('/');
          return urlParts.some(part => fileParts.includes(part.toLowerCase()));
        });
        
        if (potentialMatches.length > 0) {
          file = potentialMatches[0];
          console.log(`Found potential bin match: ${file.path}`);
        } else if (binFiles.length > 0) {
          // Last resort - use the first bin file we found
          file = binFiles[0];
          console.log(`Using fallback bin file: ${file.path}`);
        }
      }
    }
    
    if (file && file.data) {
      console.log(`Found file: ${file.path}`);
      
      // If it's a GLTF JSON file, parse it and rewrite URLs
      if (file.isGltf && file.name.endsWith('.gltf')) {
        const textDecoder = new TextDecoder('utf-8');
        const jsonContent = textDecoder.decode(file.data);
        let gltfJson;
        
        try {
          gltfJson = JSON.parse(jsonContent);
        } catch (e) {
          console.error('Failed to parse GLTF JSON:', e);
          throw new Error('Failed to parse GLTF JSON');
        }
        
        // Get the directory path of the gltf file
        const gltfDir = file.path.includes('/') 
          ? file.path.substring(0, file.path.lastIndexOf('/') + 1) 
          : '';
        
        // Process for rewriting the URLs in the GLTF
        if (gltfJson.images) {
          gltfJson.images.forEach((image: any) => {
            if (image.uri) {
              // Try different ways to find the image
              const imagePath = image.uri;
              const absoluteImagePath = gltfDir + imagePath;
              
              const imageFile = 
                fileMap.get(imagePath.toLowerCase()) || 
                fileMap.get(absoluteImagePath.toLowerCase()) ||
                extractedFiles.find(f => 
                  f.path.toLowerCase() === imagePath.toLowerCase() || 
                  f.path.toLowerCase() === absoluteImagePath.toLowerCase() ||
                  f.path.toLowerCase().endsWith('/' + imagePath.toLowerCase()) ||
                  f.name.toLowerCase() === imagePath.toLowerCase()
                );
              
              if (imageFile) {
                console.log(`Rewrote image ${imagePath} to ${imageFile.url.href}`);
                image.uri = imageFile.url.href;
              } else {
                console.warn(`Image not found: ${imagePath} (absolute: ${absoluteImagePath})`);
              }
            }
          });
        }
        
        // Process buffers to use object URLs
        if (gltfJson.buffers) {
          gltfJson.buffers.forEach((buffer: any, index: number) => {
            if (buffer.uri) {
              // Try different ways to find the buffer
              const bufferPath = buffer.uri;
              const absoluteBufferPath = gltfDir + bufferPath;
              
              console.log(`Looking for buffer: "${bufferPath}" or "${absoluteBufferPath}"`);
              
              // Try many different ways to find the buffer file
              let bufferFile = 
                fileMap.get(bufferPath.toLowerCase()) || 
                fileMap.get(absoluteBufferPath.toLowerCase()) ||
                extractedFiles.find(f => 
                  f.path.toLowerCase() === bufferPath.toLowerCase() || 
                  f.path.toLowerCase() === absoluteBufferPath.toLowerCase() ||
                  f.path.toLowerCase().endsWith('/' + bufferPath.toLowerCase()) ||
                  f.name.toLowerCase() === bufferPath.toLowerCase()
                );
              
              // If not found, try to use any .bin file as a fallback
              if (!bufferFile) {
                console.warn(`Buffer not found: ${bufferPath}. Trying fallbacks...`);
                
                // Try just using the filename part
                const bufferFilename = bufferPath.split('/').pop()!.toLowerCase();
                bufferFile = extractedFiles.find(f => f.name.toLowerCase() === bufferFilename);
                
                // Last resort - use any .bin file we can find
                if (!bufferFile && binFiles.length > 0) {
                  bufferFile = binFiles[0];
                  console.log(`Using fallback buffer: ${bufferFile.path} for ${bufferPath}`);
                }
              }
              
              if (bufferFile) {
                console.log(`Rewrote buffer ${bufferPath} to ${bufferFile.url.href}`);
                buffer.uri = bufferFile.url.href;
              } else {
                console.error(`CRITICAL: No buffer file found for ${bufferPath}`);
              }
            }
          });
        }
        
        return JSON.stringify(gltfJson);
      }
      
      return file.data;
    }
    
    // If not found in ZIP, try to fetch from network as a last resort
    console.log(`File not found in ZIP, fetching from URL: ${url}`);
    try {
      // Handle blob URLs (for files we've already processed)
      if (url.startsWith('blob:')) {
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        return await response.arrayBuffer();
      }
      
      console.warn(`Attempting to fetch from external URL: ${url} - this may fail due to CORS`);
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return await response.arrayBuffer();
    } catch (error) {
      console.error(`Error fetching ${url}:`, error);
      throw new Error(`Failed to load ${url}: ${error}`);
    }
  };
}

export function setupZipFileLoader(zipFiles: ExtractedFile[]): () => void {
  // Save the original FileLoader.prototype.load method
  const originalLoad = THREE.FileLoader.prototype.load;
  const customResourceLoader = createZipResourceLoader(zipFiles);
  
  // Override the load method
  THREE.FileLoader.prototype.load = function(
    url: string, 
    onLoad?: ((response: string | ArrayBuffer) => void), 
    onProgress?: ((event: ProgressEvent) => void),
    onError?: ((event: ErrorEvent) => void)
  ): any {
    if (!url) return null;
    
    // Use the original loader for blob URLs (we've already processed these)
    if (url.startsWith('blob:')) {
      return originalLoad.call(
        this, 
        url, 
        onLoad, 
        onProgress, 
        onError
      );
    }
    
    console.log(`ZIP loader intercepting: ${url}`);
    
    if (onLoad) {
      customResourceLoader(url)
        .then(onLoad)
        .catch((error) => {
          console.error(`ZIP loader failed for ${url}:`, error);
          if (onError) {
            const errorEvent = new ErrorEvent('error', { error });
            onError(errorEvent);
          }
        });
      
      return null;
    } else {
      return originalLoad.call(this, url, onLoad, onProgress, onError);
    }
  };
  
  // Return a cleanup function
  return () => {
    console.log("Restoring original THREE.FileLoader");
    THREE.FileLoader.prototype.load = originalLoad;
  };
}
