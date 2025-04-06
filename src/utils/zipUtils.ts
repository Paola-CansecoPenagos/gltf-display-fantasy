
import JSZip from 'jszip';
import { toast } from '@/hooks/use-toast';
import * as THREE from 'three';

export interface ExtractedFile {
  name: string;
  path: string;
  url: URL;
  isGltf: boolean;
  isBin: boolean;
  data?: ArrayBuffer;
}

export async function extractZipFile(file: File): Promise<ExtractedFile[] | null> {
  try {
    const zipInstance = new JSZip();
    const zipContent = await zipInstance.loadAsync(file);
    const extractedFiles: ExtractedFile[] = [];

    const filePromises = Object.keys(zipContent.files).map(async (filename) => {
      const zipEntry = zipContent.files[filename];
      if (zipEntry.dir) return;

      try {
        const content = await zipEntry.async('arraybuffer');
        const blob = new Blob([content]);
        const url = URL.createObjectURL(blob);
        const extension = filename.split('.').pop()?.toLowerCase();

        extractedFiles.push({
          name: filename.split('/').pop() || filename,
          path: filename,
          url: new URL(url),
          isGltf: extension === 'gltf' || extension === 'glb',
          isBin: extension === 'bin',
          data: content,
        });
      } catch (err) {
        console.error(`Error extracting file ${filename}:`, err);
      }
    });

    await Promise.all(filePromises);

    const gltfFiles = extractedFiles.filter(f => f.isGltf);
    if (gltfFiles.length === 0) {
      toast({
        title: "Error",
        description: "No se encontraron archivos GLTF o GLB en el ZIP",
        variant: "destructive",
      });
      return null;
    }

    return extractedFiles;
  } catch (error) {
    console.error('Error processing ZIP file:', error);
    toast({
      title: "Error",
      description: "Error al procesar el archivo ZIP",
      variant: "destructive",
    });
    return null;
  }
}

export function createZipResourceLoader(extractedFiles: ExtractedFile[]): (url: string) => Promise<ArrayBuffer | string> {
  const fileMap = new Map<string, ExtractedFile>();
  const binFiles = extractedFiles.filter(f => f.isBin);

  // Create multiple mappings for each file to increase chance of matching
  extractedFiles.forEach(file => {
    // Standard mappings
    fileMap.set(file.name.toLowerCase(), file);
    fileMap.set(file.path.toLowerCase(), file);
    
    // Handle paths without directories
    const strippedPath = file.path.includes('/')
      ? file.path.substring(file.path.indexOf('/') + 1)
      : file.path;
    
    fileMap.set(strippedPath.toLowerCase(), file);
    
    // Special handling for scene.bin - map all variations
    if (file.isBin) {
      fileMap.set('scene.bin', file);
      fileMap.set('/scene.bin', file);
      fileMap.set('./scene.bin', file);
    }
  });

  console.log('[ZipLoader] Available files:', extractedFiles.map(f => f.path));

  return async (url: string): Promise<ArrayBuffer | string> => {
    // Handle blob URLs directly
    if (url.startsWith('blob:')) {
      try {
        const response = await fetch(url);
        return await response.arrayBuffer();
      } catch (error) {
        console.error(`[ZipLoader] Error loading blob URL: ${url}`, error);
        
        // If we fail to load a blob that might be a binary file, try our bin files
        if (url.includes('bin') && binFiles.length > 0) {
          console.log(`[ZipLoader] Attempting bin file fallback for: ${url}`);
          return binFiles[0].data as ArrayBuffer;
        }
        
        throw error;
      }
    }
    
    const normalizedUrl = decodeURIComponent(url.split('?')[0].replace(/\\/g, '/').toLowerCase());
    const filename = normalizedUrl.split('/').pop() || normalizedUrl;

    console.log('[ZipLoader] Searching for:', normalizedUrl, '→', filename);

    // Try to find the file in our mappings
    let file = fileMap.get(normalizedUrl) ||
               fileMap.get(filename) ||
               extractedFiles.find(f => f.path.toLowerCase().endsWith(normalizedUrl)) ||
               extractedFiles.find(f => f.name.toLowerCase() === filename);

    // Special handling for bin files
    if (!file && (filename.endsWith('.bin') || normalizedUrl.includes('scene.bin'))) {
      file = binFiles[0]; // Fallback to first bin file
      if (file) {
        console.log('[ZipLoader] Fallback to bin file:', file.path);
      }
    }

    if (file && file.data) {
      if (file.isGltf && file.name.endsWith('.gltf')) {
        // Process GLTF JSON to fix relative paths
        const decoder = new TextDecoder();
        const jsonText = decoder.decode(file.data);
        const gltf = JSON.parse(jsonText);
        
        const gltfDir = file.path.includes('/')
          ? file.path.substring(0, file.path.lastIndexOf('/') + 1)
          : '';

        // Fix image paths
        if (gltf.images) {
          gltf.images.forEach((image: any) => {
            if (image.uri) {
              const fullPath = gltfDir + image.uri;
              const imageFile =
                fileMap.get(image.uri.toLowerCase()) ||
                fileMap.get(fullPath.toLowerCase());

              if (imageFile) {
                console.log(`[ZipLoader] Rewriting image URI ${image.uri} → ${imageFile.url.href}`);
                image.uri = imageFile.url.href;
              }
            }
          });
        }

        // Fix buffer paths - critical for loading bin files
        if (gltf.buffers) {
          gltf.buffers.forEach((buffer: any) => {
            if (buffer.uri) {
              // Special case: if buffer.uri is "scene.bin", check our bin files first
              if (buffer.uri.toLowerCase() === "scene.bin" && binFiles.length > 0) {
                console.log(`[ZipLoader] Direct mapping for scene.bin → ${binFiles[0].url.href}`);
                buffer.uri = binFiles[0].url.href;
                return;
              }
              
              const bufferPath = buffer.uri;
              const absoluteBufferPath = gltfDir + bufferPath;

              const bufferFile =
                fileMap.get(bufferPath.toLowerCase()) ||
                fileMap.get(absoluteBufferPath.toLowerCase()) ||
                extractedFiles.find(f =>
                  f.path.toLowerCase().endsWith(bufferPath.toLowerCase()) ||
                  f.path.toLowerCase().endsWith('/' + bufferPath.toLowerCase()) ||
                  f.name.toLowerCase() === bufferPath.toLowerCase()
                );

              if (bufferFile) {
                console.log(`[ZipLoader] Rewriting buffer URI ${bufferPath} → ${bufferFile.url.href}`);
                buffer.uri = bufferFile.url.href;
              } else if (binFiles.length > 0) {
                // Fallback to any bin file if we can't find an exact match
                console.log(`[ZipLoader] Fallback buffer URI → ${binFiles[0].url.href}`);
                buffer.uri = binFiles[0].url.href;
              }
            }
          });
        }

        return JSON.stringify(gltf);
      }

      // Return the appropriate data format based on file extension
      const ext = file.name.split('.').pop()?.toLowerCase();
      if (["glb", "bin", "png", "jpg", "jpeg", "webp"].includes(ext || '')) {
        return file.data;
      } else {
        return new TextDecoder().decode(file.data);
      }
    }

    // If we can't find the file in our archive, try loading from network
    try {
      const res = await fetch(url);
      return await res.arrayBuffer();
    } catch (error) {
      console.error(`[ZipLoader] Error loading from network: ${url}`, error);
      
      // Last resort fallback for bin files
      if ((url.includes('.bin') || filename.includes('.bin')) && binFiles.length > 0) {
        console.log(`[ZipLoader] Last resort bin fallback for ${url}`);
        return binFiles[0].data as ArrayBuffer;
      }
      
      throw new Error(`No se pudo cargar el recurso: ${url}`);
    }
  };
}
