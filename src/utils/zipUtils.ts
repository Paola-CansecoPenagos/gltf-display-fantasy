
import JSZip from 'jszip';
import { toast } from '@/hooks/use-toast';

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
export function createZipResourceLoader(extractedFiles: ExtractedFile[]): ((url: string) => Promise<any>) {
  // Create a map for faster lookups
  const fileMap = new Map<string, ExtractedFile>();
  extractedFiles.forEach(file => {
    fileMap.set(file.name, file);
    fileMap.set(file.path, file);
  });
  
  return async (url: string): Promise<ArrayBuffer | string> => {
    // Try to find the file in our extracted files
    const filename = url.split('/').pop() || url;
    const file = fileMap.get(filename) || fileMap.get(url);
    
    if (file && file.data) {
      // If it's a GLTF JSON file, parse it and rewrite URLs
      if (file.isGltf && file.name.endsWith('.gltf')) {
        const textDecoder = new TextDecoder('utf-8');
        const jsonContent = textDecoder.decode(file.data);
        const gltfJson = JSON.parse(jsonContent);
        
        // Process for rewriting the URLs in the GLTF
        if (gltfJson.images) {
          gltfJson.images.forEach((image: any) => {
            if (image.uri) {
              const imagePath = image.uri;
              const imageFile = extractedFiles.find(f => f.path.endsWith(imagePath));
              if (imageFile) {
                image.uri = imageFile.url.href;
              }
            }
          });
        }
        
        // Process buffers to use object URLs
        if (gltfJson.buffers) {
          gltfJson.buffers.forEach((buffer: any) => {
            if (buffer.uri) {
              const bufferPath = buffer.uri;
              const bufferFile = extractedFiles.find(f => f.path.endsWith(bufferPath));
              if (bufferFile) {
                buffer.uri = bufferFile.url.href;
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
    const response = await fetch(url);
    return await response.arrayBuffer();
  };
}
