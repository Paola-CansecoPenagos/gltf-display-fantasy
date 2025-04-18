import React, { useState, useCallback, useRef, Suspense, useMemo, useEffect } from 'react';
import { Canvas, useFrame, useThree, useLoader } from '@react-three/fiber';
import { 
  OrbitControls, 
  Stage, 
  Grid, 
  Environment, 
  useGLTF, 
  PerspectiveCamera,
  ContactShadows,
  useProgress,
  Html,
  useAnimations
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
import { useToast } from '@/hooks/use-toast';
import { ChevronRight, ChevronLeft, Upload, X, Maximize, Minimize, Download, FileArchive, Play, Pause, AlertCircle } from 'lucide-react';
import * as THREE from 'three';
import { extractZipFile, createZipResourceLoader, ExtractedFile } from '@/utils/zipUtils';

const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500MB como límite recomendado

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

function ErrorDisplay({ error }: { error: string }) {
  return (
    <Html center>
      <div className="bg-white p-4 rounded-md shadow-lg max-w-md">
        <div className="flex items-center text-red-500 mb-2">
          <AlertCircle className="mr-2" size={20} />
          <h3 className="font-semibold">Error al cargar el modelo</h3>
        </div>
        <p className="text-sm text-gray-700">{error}</p>
      </div>
    </Html>
  );
}

function CameraController() {
  const { camera } = useThree();
  
  useFrame(() => {
    const keys = KeyboardControls.getKeys();
    
    if (keys.has('ArrowUp')) {
      camera.position.multiplyScalar(0.95); // Move closer
    }
    if (keys.has('ArrowDown')) {
      camera.position.multiplyScalar(1.05); // Move away
    }
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

function Model({ url, scale = 1, zipFiles, onError }: { 
  url: string, 
  scale?: number, 
  zipFiles?: ExtractedFile[],
  onError?: (error: string) => void 
}) {
  const [customLoader, setCustomLoader] = useState<boolean>(false);
  const modelRef = useRef<THREE.Group>(null);
  const originalFileLoader = useRef<typeof THREE.FileLoader.prototype.load | null>(null);
  const [animationsExist, setAnimationsExist] = useState<boolean>(false);
  const [animationPlaying, setAnimationPlaying] = useState<boolean>(true);
  const [animationNames, setAnimationNames] = useState<string[]>([]);
  const [currentAnimation, setCurrentAnimation] = useState<string>("");
  const [hasError, setHasError] = useState<string>("");

  useEffect(() => {
    if (zipFiles && zipFiles.length > 0) {
      console.log("Setting up custom loader for ZIP files");
      
      if (!originalFileLoader.current) {
        originalFileLoader.current = THREE.FileLoader.prototype.load;
      }
      
      const customResourceLoader = createZipResourceLoader(zipFiles);
      
      THREE.FileLoader.prototype.load = function(
        url: string, 
        onLoad?: ((response: string | ArrayBuffer) => void), 
        onProgress?: ((event: ProgressEvent) => void),
        onError?: ((event: ErrorEvent) => void)
      ): any {
        if (!url) return null;
        
        if (url.startsWith('blob:')) {
          return originalFileLoader.current?.call(
            this, 
            url, 
            onLoad, 
            onProgress, 
            onError
          );
        }
        
        console.log(`Custom loader intercepting: ${url}`);
        
        if (onLoad) {
          customResourceLoader(url)
            .then(onLoad)
            .catch((error) => {
              console.error(`Custom loader failed for ${url}:`, error);
              if (onError) {
                const errorEvent = new ErrorEvent('error', { error });
                onError(errorEvent);
              }
            });
          
          return null;
        } else {
          return originalFileLoader.current?.call(this, url, onLoad, onProgress, onError);
        }
      };
      
      setCustomLoader(true);
    }
    
    return () => {
      if (customLoader && originalFileLoader.current) {
        console.log("Restoring original FileLoader");
        THREE.FileLoader.prototype.load = originalFileLoader.current;
        setCustomLoader(false);
      }
    };
  }, [zipFiles]);
  
  const key = useMemo(() => zipFiles ? Math.random().toString() : url, [url, zipFiles]);
  
  let gltfResult;
  try {
    gltfResult = useGLTF(url);
  } catch (error) {
    console.error("Error loading GLTF model:", error);
    const errorMessage = error instanceof Error ? error.message : "Error desconocido al cargar el modelo";
    setHasError(errorMessage);
    if (onError) onError(errorMessage);
    return <ErrorDisplay error={errorMessage} />;
  }

  if (hasError) {
    return <ErrorDisplay error={hasError} />;
  }

  const { animations } = gltfResult;
  const { actions, names } = useAnimations(animations, modelRef);
  
  useEffect(() => {
    if (animations && animations.length > 0) {
      setAnimationsExist(true);
      setAnimationNames(names);
      
      if (names.length > 0) {
        const firstAnimation = names[0];
        setCurrentAnimation(firstAnimation);
        
        if (actions[firstAnimation]) {
          actions[firstAnimation].reset().play();
          console.log(`Playing animation: ${firstAnimation}`);
        }
      }
    } else {
      setAnimationsExist(false);
      setAnimationNames([]);
      setCurrentAnimation("");
    }
  }, [animations, actions, names]);
  
  useEffect(() => {
    if (currentAnimation && actions[currentAnimation]) {
      if (animationPlaying) {
        actions[currentAnimation].paused = false;
        actions[currentAnimation].play();
      } else {
        actions[currentAnimation].paused = true;
      }
    }
  }, [animationPlaying, currentAnimation, actions]);
  
  const handleAnimationChange = (animationName: string) => {
    if (currentAnimation && actions[currentAnimation]) {
      actions[currentAnimation].stop();
    }
    
    setCurrentAnimation(animationName);
    
    if (actions[animationName]) {
      actions[animationName].reset().play();
      setAnimationPlaying(true);
    }
  };
  
  const toggleAnimation = () => {
    setAnimationPlaying(!animationPlaying);
  };
  
  const clone = useMemo(() => gltfResult.scene.clone(), [gltfResult.scene]);
  
  useFrame(({ clock }) => {
    if (modelRef.current) {
      const keys = KeyboardControls.getKeys();
      
      if (keys.has('ArrowLeft')) modelRef.current.rotation.y += 0.02;
      if (keys.has('ArrowRight')) modelRef.current.rotation.y -= 0.02;
      
      if (keys.has('Equal') || keys.has('+')) modelRef.current.scale.multiplyScalar(1.01);
      if (keys.has('Minus') || keys.has('-')) modelRef.current.scale.multiplyScalar(0.99);
      
      if (keys.has('KeyR')) {
        modelRef.current.rotation.set(0, 0, 0);
      }
    }
  });
  
  return (
    <>
      <primitive 
        ref={modelRef}
        object={clone} 
        scale={Array.isArray(scale) ? scale : [scale, scale, scale]} 
        dispose={null}
        key={key}
      />
      
      {animationsExist && (
        <Html position={[0, -2, 0]} center>
          <div className="bg-white/80 backdrop-blur-sm p-3 rounded-md shadow-lg">
            <div className="flex items-center gap-2 mb-2">
              <Button 
                variant="outline" 
                size="sm" 
                className="p-1 h-8 w-8" 
                onClick={toggleAnimation}
              >
                {animationPlaying ? <Pause size={16} /> : <Play size={16} />}
              </Button>
              <span className="text-sm font-medium">
                {animationPlaying ? "Pausar" : "Reproducir"} animación
              </span>
            </div>
            
            {animationNames.length > 1 && (
              <Select 
                value={currentAnimation}
                onValueChange={handleAnimationChange}
              >
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue placeholder="Seleccionar animación" />
                </SelectTrigger>
                <SelectContent>
                  {animationNames.map((name) => (
                    <SelectItem key={name} value={name} className="text-sm">
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </Html>
      )}
    </>
  );
}

const GltfViewer = () => {
  const { toast } = useToast();
  const [modelUrl, setModelUrl] = useState<string>(PRESET_MODELS[0].url);
  const [urlInput, setUrlInput] = useState<string>('');
  const [isPanelOpen, setIsPanelOpen] = useState<boolean>(true);
  const [modelInfo, setModelInfo] = useState<string>('');
  const [backgroundColor, setBackgroundColor] = useState<string>('#f5f5f5');
  const [environmentPreset, setEnvironmentPreset] = useState<string>('sunset');
  const [showGrid, setShowGrid] = useState<boolean>(true);
  const [showAxes, setShowAxes] = useState<boolean>(true);
  const [showShadows, setShowShadows] = useState<boolean>(true);
  const [autoRotate, setAutoRotate] = useState<boolean>(false);
  const [scale, setScale] = useState<number>(1);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const zipInputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState<boolean>(false);
  const [zipFiles, setZipFiles] = useState<ExtractedFile[] | null>(null);
  const [modelError, setModelError] = useState<string | null>(null);
  const [modelKey, setModelKey] = useState<string>('initial');

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  }, []);
  
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      handleFiles(file);
    }
  }, []);

  const handleZipFileUpload = useCallback(async (file: File) => {
    if (!file.name.match(/\.(zip)$/i)) {
      toast({
        title: "Error de formato",
        description: "Solo se permiten archivos ZIP",
        variant: "destructive"
      });
      return;
    }

    if (file.size > MAX_FILE_SIZE) {
      toast({
        title: "Archivo demasiado grande",
        description: `El archivo es demasiado grande (${(file.size / 1024 / 1024).toFixed(2)} MB). El tamaño máximo permitido es ${MAX_FILE_SIZE / 1024 / 1024} MB.`,
        variant: "destructive"
      });
      return;
    }

    console.log("Processing ZIP file:", file.name);
    try {
      const extractedFiles = await extractZipFile(file);
      if (!extractedFiles) return;

      const gltfFile = extractedFiles.find(f => f.isGltf);
      if (!gltfFile) {
        toast({
          title: "Error",
          description: "No se encontraron archivos GLTF o GLB en el ZIP",
          variant: "destructive"
        });
        return;
      }

      setZipFiles(extractedFiles);
      
      setTimeout(() => {
        setModelError(null);
        setModelUrl(gltfFile.url.href);
        setModelInfo(`Modelo desde ZIP: ${file.name} - ${gltfFile.name}`);
        setModelKey(Math.random().toString()); // Forzar remontada del modelo
        
        toast({
          title: "Modelo ZIP cargado",
          description: `Se encontraron ${extractedFiles.length} archivos, usando ${gltfFile.name}`,
        });
      }, 300);
    } catch (error) {
      console.error("Error processing ZIP file:", error);
      toast({
        title: "Error al procesar ZIP",
        description: "No se pudo extraer el archivo ZIP correctamente",
        variant: "destructive"
      });
    }
    
  }, [toast]);
  
  const handleFiles = useCallback((file: File) => {
    if (file.size > MAX_FILE_SIZE) {
      toast({
        title: "Archivo demasiado grande",
        description: `El archivo es demasiado grande (${(file.size / 1024 / 1024).toFixed(2)} MB). El tamaño máximo permitido es ${MAX_FILE_SIZE / 1024 / 1024} MB.`,
        variant: "destructive"
      });
      return;
    }

    if (file.name.endsWith('.zip')) {
      handleZipFileUpload(file);
      return;
    }
    
    if (!file.name.match(/\.(gltf|glb)$/i)) {
      toast({
        title: "Error de formato",
        description: "Solo se permiten archivos GLTF, GLB o ZIP",
        variant: "destructive"
      });
      return;
    }
    
    setZipFiles(null);
    
    try {
      const url = URL.createObjectURL(file);
      setModelUrl(url);
      setModelInfo(`Modelo: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`);
      setModelError(null);
      setModelKey(Math.random().toString()); // Forzar remontada del modelo
      
      toast({
        title: "Modelo cargado",
        description: `${file.name} se ha cargado correctamente`,
      });
    } catch (error) {
      console.error("Error creating object URL:", error);
      toast({
        title: "Error al cargar modelo",
        description: "No se pudo cargar el archivo correctamente",
        variant: "destructive"
      });
    }
  }, [toast, handleZipFileUpload]);
  
  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFiles(e.target.files[0]);
    }
  }, [handleFiles]);
  
  const loadModelFromUrl = useCallback(() => {
    if (!urlInput) return;
    
    try {
      new URL(urlInput);
      setZipFiles(null);
      setModelUrl(urlInput);
      setModelInfo(`Modelo: URL externa`);
      setModelError(null);
      setModelKey(Math.random().toString()); // Forzar remontada del modelo
      toast({
        title: "Modelo cargado",
        description: "El modelo se ha cargado desde la URL",
      });
    } catch (err) {
      toast({
        title: "URL inválida",
        description: "Por favor, ingresa una URL válida",
        variant: "destructive"
      });
    }
  }, [urlInput, toast]);
  
  const loadPresetModel = useCallback((model: typeof PRESET_MODELS[0]) => {
    setZipFiles(null);
    setModelUrl(model.url);
    setModelInfo(`Modelo: ${model.name}`);
    setModelError(null);
    setModelKey(Math.random().toString()); // Forzar remontada del modelo
    toast({
      title: "Modelo cargado",
      description: `${model.name} se ha cargado correctamente`,
    });
  }, [toast]);
  
  const resetViewer = useCallback(() => {
    setZipFiles(null);
    setModelUrl(PRESET_MODELS[0].url);
    setModelInfo(`Modelo: ${PRESET_MODELS[0].name}`);
    setBackgroundColor('#f5f5f5');
    setEnvironmentPreset('sunset');
    setShowGrid(true);
    setShowAxes(true);
    setShowShadows(true);
    setAutoRotate(false);
    setScale(1);
    setModelError(null);
    setModelKey(Math.random().toString()); // Forzar remontada del modelo
    
    toast({
      title: "Visor reiniciado",
      description: "Todas las configuraciones se han restablecido",
    });
  }, [toast]);
  
  const handleModelError = useCallback((error: string) => {
    setModelError(error);
    toast({
      title: "Error al cargar modelo",
      description: error,
      variant: "destructive"
    });
  }, [toast]);
  
  useEffect(() => {
    return () => {
      KeyboardControls.cleanup();
      
      if (zipFiles) {
        zipFiles.forEach(file => {
          if (file.url) {
            URL.revokeObjectURL(file.url.href);
          }
        });
      }
    };
  }, [zipFiles]);

  const renderKeyboardHelp = () => (
    <div className="keyboard-help absolute bottom-4 right-4 bg-black/70 text-white p-3 rounded-md text-sm z-10">
      <h4 className="text-base font-semibold mb-1">Control con teclado:</h4>
      <ul className="list-disc pl-5 space-y-1">
        <li>Flechas ←/→: Rotar modelo</li>
        <li>Flechas ↑/↓: Acercarse/Alejarse</li>
        <li>+ / -: Escalar modelo</li>
        <li>R: Reiniciar rotación</li>
      </ul>
    </div>
  );

  return (
    <div className="gltf-viewer-container">
      <Canvas 
        key={modelKey}
        style={{ background: backgroundColor }}
        camera={{ position: [5, 5, 5], fov: 50 }}
        shadows
      >
        <Suspense fallback={<LoadingIndicator />}>
          <Environment preset={environmentPreset as any} background={false} />
          
          {!modelError && (
            <Model 
              url={modelUrl} 
              scale={scale} 
              zipFiles={zipFiles || undefined} 
              onError={handleModelError}
            />
          )}
          
          <CameraController />
          
          {showGrid && <Grid infiniteGrid cellSize={1} sectionSize={3} fadeDistance={30} />}
          {showAxes && <axesHelper args={[5]} />}
          
          {showShadows && <ContactShadows opacity={0.5} scale={10} blur={1} far={10} />}
          
          <OrbitControls 
            autoRotate={autoRotate}
            autoRotateSpeed={1}
            enableDamping
            dampingFactor={0.05}
            minDistance={1}
            maxDistance={100}
          />
        </Suspense>
      </Canvas>
      
      <Button 
        variant="secondary" 
        className={`toggle-panel-btn ${!isPanelOpen ? 'panel-collapsed' : ''}`}
        onClick={() => setIsPanelOpen(!isPanelOpen)}
      >
        {isPanelOpen ? <ChevronRight /> : <ChevronLeft />}
      </Button>
      
      {renderKeyboardHelp()}
      
      {modelInfo && (
        <div className="model-info">
          {modelInfo}
        </div>
      )}
      
      <div className={`controls-panel ${!isPanelOpen ? 'collapsed' : ''}`}>
        <div className="p-4">
          <h2 className="text-2xl font-bold mb-4">Visor GLTF</h2>
          
          <Tabs defaultValue="upload">
            <TabsList className="w-full mb-4">
              <TabsTrigger value="upload" className="flex-1">Cargar</TabsTrigger>
              <TabsTrigger value="settings" className="flex-1">Ajustes</TabsTrigger>
            </TabsList>
            
            <TabsContent value="upload">
              <Card>
                <CardHeader>
                  <CardTitle>Cargar modelo</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="mb-3 p-3 bg-yellow-50 border border-yellow-300 rounded-md text-sm">
                    <p className="flex items-center">
                      <AlertCircle size={16} className="text-yellow-500 mr-2" />
                      <span>Tamaño máximo recomendado: {MAX_FILE_SIZE / 1024 / 1024} MB</span>
                    </p>
                  </div>
                  
                  <div 
                    className={`dropzone ${dragActive ? 'active' : ''}`}
                    onDragEnter={handleDrag}
                    onDragOver={handleDrag}
                    onDragLeave={handleDrag}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload className="mx-auto mb-2" />
                    <p>Arrastra un archivo GLTF/GLB/ZIP aquí o haz clic para explorar</p>
                    <input 
                      ref={fileInputRef}
                      type="file" 
                      accept=".gltf,.glb,.zip"
                      onChange={handleFileChange}
                      className="hidden"
                    />
                  </div>
                  
                  <div className="mt-4 flex gap-2">
                    <Button 
                      variant="outline" 
                      className="flex-1 gap-2"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <Upload size={18} />
                      Cargar GLTF/GLB
                    </Button>
                    <Button 
                      variant="outline" 
                      className="flex-1 gap-2"
                      onClick={() => {
                        if (fileInputRef.current) {
                          fileInputRef.current.accept = ".zip";
                          fileInputRef.current.click();
                          setTimeout(() => {
                            if (fileInputRef.current) {
                              fileInputRef.current.accept = ".gltf,.glb,.zip";
                            }
                          }, 100);
                        }
                      }}
                    >
                      <FileArchive size={18} />
                      Cargar ZIP
                    </Button>
                  </div>
                  
                  <div className="mt-4">
                    <Label htmlFor="url-input">O carga desde URL:</Label>
                    <div className="flex mt-2">
                      <Input 
                        id="url-input"
                        placeholder="https://ejemplo.com/modelo.gltf" 
                        value={urlInput}
                        onChange={(e) => setUrlInput(e.target.value)}
                        className="flex-1 mr-2"
                      />
                      <Button onClick={loadModelFromUrl}>Cargar</Button>
                    </div>
                  </div>
                  
                  <div className="mt-4">
                    <Label>Modelos de ejemplo:</Label>
                    <div className="preset-models">
                      {PRESET_MODELS.map((model) => (
                        <div 
                          key={model.name}
                          className="preset-model-btn"
                          onClick={() => loadPresetModel(model)}
                        >
                          {model.name}
                        </div>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
            
            <TabsContent value="settings">
              <Card>
                <CardHeader>
                  <CardTitle>Ajustes de visualización</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <Label htmlFor="bg-color">Color de fondo:</Label>
                    <div className="flex items-center mt-1">
                      <Input 
                        id="bg-color"
                        type="color" 
                        value={backgroundColor}
                        onChange={(e) => setBackgroundColor(e.target.value)}
                        className="w-12 h-8 p-0 mr-2"
                      />
                      <Input 
                        value={backgroundColor}
                        onChange={(e) => setBackgroundColor(e.target.value)}
                        className="flex-1"
                      />
                    </div>
                  </div>
                  
                  <div>
                    <Label htmlFor="environment">Entorno:</Label>
                    <Select 
                      value={environmentPreset}
                      onValueChange={setEnvironmentPreset}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Selecciona un entorno" />
                      </SelectTrigger>
                      <SelectContent>
                        {ENVIRONMENTS.map((env) => (
                          <SelectItem key={env} value={env}>
                            {env.charAt(0).toUpperCase() + env.slice(1)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <div>
                    <Label>Escala: {scale.toFixed(2)}</Label>
                    <Slider
                      value={[scale]}
                      min={0.01}
                      max={5}
                      step={0.01}
                      onValueChange={(value) => setScale(value[0])}
                      className="mt-2"
                    />
                  </div>
                  
                  <Separator />
                  
                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <Label htmlFor="show-grid">Mostrar cuadrícula</Label>
                      <Switch 
                        id="show-grid"
                        checked={showGrid}
                        onCheckedChange={setShowGrid}
                      />
                    </div>
                    
                    <div className="flex justify-between items-center">
                      <Label htmlFor="show-axes">Mostrar ejes</Label>
                      <Switch 
                        id="show-axes"
                        checked={showAxes}
                        onCheckedChange={setShowAxes}
                      />
                    </div>
                    
                    <div className="flex justify-between items-center">
                      <Label htmlFor="show-shadows">Mostrar sombras</Label>
                      <Switch 
                        id="show-shadows"
                        checked={showShadows}
                        onCheckedChange={setShowShadows}
                      />
                    </div>
                    
                    <div className="flex justify-between items-center">
                      <Label htmlFor="auto-rotate">Rotación automática</Label>
                      <Switch 
                        id="auto-rotate"
                        checked={autoRotate}
                        onCheckedChange={setAutoRotate}
                      />
                    </div>
                  </div>
                  
                  <Separator />
                  
                  <Button variant="outline" className="w-full" onClick={resetViewer}>
                    Reiniciar configuración
                  </Button>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
};

export default GltfViewer;
