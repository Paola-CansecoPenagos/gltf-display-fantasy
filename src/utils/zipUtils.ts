
import * as THREE from 'three';
import JSZip from 'jszip';
import { toast } from '@/hooks/use-toast';

// Constante para el tamaño máximo de archivo (en bytes)
const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500MB como límite recomendado

export interface ExtractedFile {
  name: string;
  path: string;
  url: URL;
  isGltf: boolean;
  data?: ArrayBuffer;
}

export async function extractZipFile(file: File): Promise<ExtractedFile[] | null> {
  try {
    // Verificar tamaño del archivo
    if (file.size > MAX_FILE_SIZE) {
      toast({
        title: "Error",
        description: `El archivo es demasiado grande (${(file.size / 1024 / 1024).toFixed(2)} MB). El tamaño máximo permitido es ${MAX_FILE_SIZE / 1024 / 1024} MB.`,
        variant: "destructive"
      });
      return null;
    }

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
  
  // Log available files for debugging
  console.log('ZIP contents:', extractedFiles.map(f => f.path));
  
  return async (url: string): Promise<ArrayBuffer | string> => {
    // Normalize the URL (remove query parameters, normalize directory separators)
    let normalizedUrl = url.split('?')[0].toLowerCase();
    normalizedUrl = normalizedUrl.replace(/\\/g, '/');
    
    // Extract just the filename without path
    const filename = normalizedUrl.split('/').pop() || normalizedUrl;
    
    console.log(`Looking for: ${normalizedUrl} or ${filename}`);
    
    // Try different ways to find the file
    let file = fileMap.get(normalizedUrl) || 
               fileMap.get(filename) || 
               extractedFiles.find(f => f.path.toLowerCase().endsWith(normalizedUrl)) ||
               extractedFiles.find(f => f.path.toLowerCase().endsWith('/' + filename)) ||
               extractedFiles.find(f => f.name.toLowerCase() === filename);
    
    // Special check for buffer files like scene.bin which are often referenced with different paths
    if (!file && filename.endsWith('.bin')) {
      file = extractedFiles.find(f => f.name.toLowerCase().endsWith('.bin'));
      if (file) {
        console.log(`Found buffer file by extension: ${file.path}`);
      }
    }
    
    if (file && file.data) {
      console.log(`Found file: ${file.path}`);
      
      // If it's a GLTF JSON file, parse it and rewrite URLs
      if (file.isGltf && file.name.endsWith('.gltf')) {
        const textDecoder = new TextDecoder('utf-8');
        const jsonContent = textDecoder.decode(file.data);
        let gltfJson = JSON.parse(jsonContent);
        
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
                  f.path.toLowerCase().endsWith('/' + imagePath.toLowerCase())
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
          gltfJson.buffers.forEach((buffer: any) => {
            if (buffer.uri) {
              // Try different ways to find the buffer
              const bufferPath = buffer.uri;
              const absoluteBufferPath = gltfDir + bufferPath;
              
              const bufferFile = 
                fileMap.get(bufferPath.toLowerCase()) || 
                fileMap.get(absoluteBufferPath.toLowerCase()) ||
                extractedFiles.find(f => 
                  f.path.toLowerCase() === bufferPath.toLowerCase() || 
                  f.path.toLowerCase() === absoluteBufferPath.toLowerCase() ||
                  f.path.toLowerCase().endsWith('/' + bufferPath.toLowerCase()) ||
                  f.name.toLowerCase() === bufferPath.toLowerCase()
                );
              
              if (bufferFile) {
                console.log(`Rewrote buffer ${bufferPath} to ${bufferFile.url.href}`);
                buffer.uri = bufferFile.url.href;
              } else {
                console.warn(`Buffer not found: ${bufferPath} (absolute: ${absoluteBufferPath})`);
                
                // Last resort: check if there's any .bin file that could be this buffer
                const anyBinFile = extractedFiles.find(f => f.name.toLowerCase().endsWith('.bin'));
                if (anyBinFile) {
                  console.log(`Using alternative bin file: ${anyBinFile.path}`);
                  buffer.uri = anyBinFile.url.href;
                }
              }
            }
          });
        }
        
        return JSON.stringify(gltfJson);
      }
      
      return file.data;
    }
    
    // If not found in ZIP, fetch from network
    console.log(`File not found in ZIP, fetching from URL: ${url}`);
    try {
      const response = await fetch(url);
      return await response.arrayBuffer();
    } catch (error) {
      console.error(`Error fetching ${url}:`, error);
      throw new Error(`Failed to load ${url}: ${error}`);
    }
  };
}
