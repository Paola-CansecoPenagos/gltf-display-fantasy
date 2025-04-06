import React, { useState, useCallback, useRef, Suspense, useMemo, useEffect } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { 
  OrbitControls, 
  Grid, 
  Environment, 
  useGLTF, 
  ContactShadows,
  useProgress,
  Html
} from '@react-three/drei';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/components/ui/use-toast';
import { ChevronRight, ChevronLeft, Upload, FileArchive } from 'lucide-react';
import * as THREE from 'three';
import { extractZipFile, createZipResourceLoader, ExtractedFile } from '@/utils/zipUtils';

const PRESET_MODELS = [
  {
    name: 'Duck',
    url: 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/master/2.0/Duck/glTF/Duck.gltf'
  },
  {
    name: 'Damaged Helmet',
    url: 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/master/2.0/DamagedHelmet/glTF/DamagedHelmet.gltf'
  },
  {
    name: 'Flight Helmet',
    url: 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/master/2.0/FlightHelmet/glTF/FlightHelmet.gltf'
  },
  {
    name: 'Avocado',
    url: 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/master/2.0/Avocado/glTF/Avocado.gltf'
  },
  {
    name: 'Sponza',
    url: 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/master/2.0/Sponza/glTF/Sponza.gltf'
  },
  {
    name: 'Buggy',
    url: 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/master/2.0/Buggy/glTF/Buggy.gltf'
  }
];

const ENVIRONMENTS = [
  'sunset', 'dawn', 'night', 'warehouse', 'forest', 'apartment', 'studio', 'city', 'park', 'lobby'
];

function LoadingIndicator() {
  const { progress } = useProgress();
  return (
    <Html center>
      <div className="bg-white p-4 rounded-md shadow-lg">
        <div className="text-center font-semibold mb-2">Cargando modelo...</div>
        <div className="w-48 h-2 bg-gray-200 rounded-full overflow-hidden">
          <div 
            className="h-full bg-blue-500 rounded-full" 
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="text-center text-sm mt-1">{progress.toFixed(0)}%</div>
      </div>
    </Html>
  );
}

function CameraController() {
  const { camera } = useThree();

  useFrame(() => {
    const keys = KeyboardControls.getKeys();

    if (keys.has('ArrowUp')) camera.position.multiplyScalar(0.95);
    if (keys.has('ArrowDown')) camera.position.multiplyScalar(1.05);
  });

  return null;
}

class KeyboardControlsManager {
  pressedKeys = new Set<string>();

  constructor() {
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
  }

  handleKeyDown = (e: KeyboardEvent) => {
    this.pressedKeys.add(e.code);
  };

  handleKeyUp = (e: KeyboardEvent) => {
    this.pressedKeys.delete(e.code);
  };

  getKeys() {
    return this.pressedKeys;
  }

  cleanup() {
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
  }
}

const KeyboardControls = new KeyboardControlsManager();

useGLTF.preload(PRESET_MODELS[0].url);

function Model({ url, scale = 1, zipFiles }: { url: string, scale?: number, zipFiles?: ExtractedFile[] }) {
  const modelRef = useRef<THREE.Group>(null);
  const originalFileLoader = useRef<typeof THREE.FileLoader.prototype.load | null>(null);

  useEffect(() => {
    if (zipFiles && zipFiles.length > 0) {
      if (!originalFileLoader.current) {
        originalFileLoader.current = THREE.FileLoader.prototype.load;
      }

      const customResourceLoader = createZipResourceLoader(zipFiles);

      THREE.FileLoader.prototype.load = function(url, onLoad, onProgress, onError) {
        if (!url) return;

        if (url.startsWith('blob:')) {
          return originalFileLoader.current?.call(this, url, onLoad, onProgress, onError);
        }

        customResourceLoader(url)
          .then(onLoad!)
          .catch(error => {
            if (onError) onError(new ErrorEvent('error', { error }));
          });
      };
    }

    return () => {
      if (originalFileLoader.current) {
        THREE.FileLoader.prototype.load = originalFileLoader.current;
      }
    };
  }, [zipFiles]);

  const key = useMemo(() => zipFiles ? Math.random().toString() : url, [url, zipFiles]);

  const gltfResult = useGLTF(url);
  const clone = useMemo(() => gltfResult.scene.clone(), [gltfResult.scene]);

  useFrame(() => {
    if (modelRef.current) {
      const keys = KeyboardControls.getKeys();
      if (keys.has('ArrowLeft')) modelRef.current.rotation.y += 0.02;
      if (keys.has('ArrowRight')) modelRef.current.rotation.y -= 0.02;
      if (keys.has('Equal') || keys.has('+')) modelRef.current.scale.multiplyScalar(1.01);
      if (keys.has('Minus') || keys.has('-')) modelRef.current.scale.multiplyScalar(0.99);
      if (keys.has('KeyR')) modelRef.current.rotation.set(0, 0, 0);
    }
  });

  return <primitive ref={modelRef} object={clone} scale={[scale, scale, scale]} dispose={null} key={key} />;
}

const GltfViewer = () => {
  const { toast } = useToast();
  const [modelUrl, setModelUrl] = useState<string>(PRESET_MODELS[0].url);
  const [zipFiles, setZipFiles] = useState<ExtractedFile[] | null>(null);
  const [loaderReady, setLoaderReady] = useState<boolean>(false);
  const [scale, setScale] = useState<number>(1);
  const [environmentPreset, setEnvironmentPreset] = useState<string>('sunset');
  const [backgroundColor, setBackgroundColor] = useState<string>('#f5f5f5');

  const handleZipFileUpload = async (file: File) => {
    const extracted = await extractZipFile(file);
    if (!extracted) return;

    const gltfFile = extracted.find(f => f.isGltf);
    if (!gltfFile) return;

    setZipFiles(extracted);
    setModelUrl(gltfFile.url.href);
    setLoaderReady(true);
  };

  return (
    <div className="gltf-viewer-container">
      <Canvas style={{ background: backgroundColor }} camera={{ position: [5, 5, 5], fov: 50 }} shadows>
        <Suspense fallback={<LoadingIndicator />}>
          <Environment preset={environmentPreset as any} background={false} />
          {(!zipFiles || loaderReady) && <Model url={modelUrl} scale={scale} zipFiles={zipFiles || undefined} />}
          <CameraController />
          <Grid infiniteGrid cellSize={1} sectionSize={3} fadeDistance={30} />
          <ContactShadows opacity={0.5} scale={10} blur={1} far={10} />
          <OrbitControls autoRotate enableDamping dampingFactor={0.05} minDistance={1} maxDistance={100} />
        </Suspense>
      </Canvas>
    </div>
  );
};

export default GltfViewer;
