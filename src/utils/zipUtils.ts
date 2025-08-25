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

    const filePromises = Object.keys(zipContent.files).map(async (filename) => {
      const zipEntry = zipContent.files[filename];
      if (zipEntry.dir) return;

      try {
        const content = await zipEntry.async('arraybuffer');
        const blob = new Blob([content]);
        const url = new URL(URL.createObjectURL(blob));
        const extension = filename.split('.').pop()?.toLowerCase();

        extractedFiles.push({
          name: filename.split('/').pop() || filename,
          path: filename,
          url,
          isGltf: extension === 'gltf' || extension === 'glb',
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

  extractedFiles.forEach(file => {
    fileMap.set(file.name.toLowerCase(), file);
    fileMap.set(file.path.toLowerCase(), file);

    const strippedPath = file.path.includes('/')
      ? file.path.substring(file.path.indexOf('/') + 1)
      : file.path;

    fileMap.set(strippedPath.toLowerCase(), file);
  });

  console.log('[ZipLoader] Available files:', extractedFiles.map(f => f.path));

  return async (url: string): Promise<ArrayBuffer | string> => {
    const normalizedUrl = decodeURIComponent(url.split('?')[0].replace(/\\/g, '/').toLowerCase());
    const filename = normalizedUrl.split('/').pop() || normalizedUrl;

    console.log('[ZipLoader] Searching for:', normalizedUrl, '→', filename);

    let file = fileMap.get(normalizedUrl) ||
               fileMap.get(filename) ||
               extractedFiles.find(f => f.path.toLowerCase().endsWith(normalizedUrl)) ||
               extractedFiles.find(f => f.name.toLowerCase() === filename);

    if (!file && filename.endsWith('.bin')) {
      file = extractedFiles.find(f => f.name.toLowerCase().endsWith('.bin'));
      if (file) {
        console.log('[ZipLoader] Fallback to .bin file:', file.path);
      }
    }

    if (file && file.data) {
      if (file.isGltf && file.name.endsWith('.gltf')) {
        const decoder = new TextDecoder();
        const jsonText = decoder.decode(file.data);
        const gltf = JSON.parse(jsonText);
        const gltfDir = file.path.includes('/')
          ? file.path.substring(0, file.path.lastIndexOf('/') + 1)
          : '';

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

        if (gltf.buffers) {
          gltf.buffers.forEach((buffer: any) => {
            if (buffer.uri) {
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
              } else {
                const anyBinFile = extractedFiles.find(f => f.name.toLowerCase().endsWith('.bin'));
                if (anyBinFile) {
                  console.log(`[ZipLoader] Fallback buffer URI → ${anyBinFile.url.href}`);
                  buffer.uri = anyBinFile.url.href;
                }
              }
            }
          });
        }

        return JSON.stringify(gltf);
      }

      const ext = file.name.split('.').pop()?.toLowerCase();
      if (["glb", "bin", "png", "jpg", "jpeg", "webp"].includes(ext || '')) {
        return file.data;
      } else {
        return new TextDecoder().decode(file.data);
      }
    }

    try {
      const res = await fetch(url);
      return await res.arrayBuffer();
    } catch (error) {
      console.error(`Error loading from network: ${url}`, error);
      throw new Error(`No se pudo cargar el recurso: ${url}`);
    }
  };
}

