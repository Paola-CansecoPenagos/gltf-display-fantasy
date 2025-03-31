
import React, { useState, useCallback, useRef, Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { 
  OrbitControls, 
  Stage, 
  Grid, 
  Environment, 
  useGLTF, 
  PerspectiveCamera,
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
import { ChevronRight, ChevronLeft, Upload, X, Maximize, Minimize, Download } from 'lucide-react';
import * as THREE from 'three';

// Default models for quick testing
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

// Environment presets
const ENVIRONMENTS = [
  'sunset', 'dawn', 'night', 'warehouse', 'forest', 'apartment', 'studio', 'city', 'park', 'lobby'
];

// Loading indicator component
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

// The actual 3D model component
function Model({ url, scale = 1 }: { url: string, scale?: number }) {
  const { scene } = useGLTF(url);
  
  // Create a clone to avoid modifying the cached original
  const clone = useMemo(() => scene.clone(), [scene]);
  
  return (
    <primitive 
      object={clone} 
      scale={Array.isArray(scale) ? scale : [scale, scale, scale]} 
      dispose={null}
    />
  );
}

// Add a cache invalidation mechanism
useGLTF.preload(PRESET_MODELS[0].url);

// Main component
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
  const [dragActive, setDragActive] = useState<boolean>(false);
  
  // Handle the drag events
  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  }, []);
  
  // Handle the file drop
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      handleFiles(file);
    }
  }, []);
  
  // Process files (from drop or file input)
  const handleFiles = useCallback((file: File) => {
    // Only accept glTF/GLB files
    if (!file.name.match(/\.(gltf|glb)$/i)) {
      toast({
        title: "Error de formato",
        description: "Solo se permiten archivos GLTF o GLB",
        variant: "destructive"
      });
      return;
    }
    
    const url = URL.createObjectURL(file);
    setModelUrl(url);
    setModelInfo(`Modelo: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`);
    
    toast({
      title: "Modelo cargado",
      description: `${file.name} se ha cargado correctamente`,
    });
  }, [toast]);
  
  // Handle file input change
  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFiles(e.target.files[0]);
    }
  }, [handleFiles]);
  
  // Load a model from URL
  const loadModelFromUrl = useCallback(() => {
    if (!urlInput) return;
    
    // Basic URL validation
    try {
      new URL(urlInput);
      setModelUrl(urlInput);
      setModelInfo(`Modelo: URL externa`);
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
  
  // Load a preset model
  const loadPresetModel = useCallback((model: typeof PRESET_MODELS[0]) => {
    setModelUrl(model.url);
    setModelInfo(`Modelo: ${model.name}`);
    toast({
      title: "Modelo cargado",
      description: `${model.name} se ha cargado correctamente`,
    });
  }, [toast]);
  
  // Reset the viewer
  const resetViewer = useCallback(() => {
    setModelUrl(PRESET_MODELS[0].url);
    setModelInfo(`Modelo: ${PRESET_MODELS[0].name}`);
    setBackgroundColor('#f5f5f5');
    setEnvironmentPreset('sunset');
    setShowGrid(true);
    setShowAxes(true);
    setShowShadows(true);
    setAutoRotate(false);
    setScale(1);
    
    toast({
      title: "Visor reiniciado",
      description: "Todas las configuraciones se han restablecido",
    });
  }, [toast]);
  
  return (
    <div className="gltf-viewer-container">
      {/* Canvas for 3D rendering */}
      <Canvas 
        style={{ background: backgroundColor }}
        camera={{ position: [5, 5, 5], fov: 50 }}
        shadows
      >
        <Suspense fallback={<LoadingIndicator />}>
          {/* Environment and lighting */}
          <Environment preset={environmentPreset as any} background={false} />
          
          {/* The 3D model */}
          <Model url={modelUrl} scale={scale} />
          
          {/* Grid and axes */}
          {showGrid && <Grid infiniteGrid cellSize={1} sectionSize={3} fadeDistance={30} />}
          {showAxes && <axesHelper args={[5]} />}
          
          {/* Shadows */}
          {showShadows && <ContactShadows opacity={0.5} scale={10} blur={1} far={10} />}
          
          {/* Camera controls */}
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
      
      {/* Control panel toggle button */}
      <Button 
        variant="secondary" 
        className={`toggle-panel-btn ${!isPanelOpen ? 'panel-collapsed' : ''}`}
        onClick={() => setIsPanelOpen(!isPanelOpen)}
      >
        {isPanelOpen ? <ChevronRight /> : <ChevronLeft />}
      </Button>
      
      {/* Model info display */}
      {modelInfo && (
        <div className="model-info">
          {modelInfo}
        </div>
      )}
      
      {/* Control panel */}
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
                  {/* File upload area */}
                  <div 
                    className={`dropzone ${dragActive ? 'active' : ''}`}
                    onDragEnter={handleDrag}
                    onDragOver={handleDrag}
                    onDragLeave={handleDrag}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload className="mx-auto mb-2" />
                    <p>Arrastra un archivo GLTF/GLB aquí o haz clic para explorar</p>
                    <input 
                      ref={fileInputRef}
                      type="file" 
                      accept=".gltf,.glb"
                      onChange={handleFileChange}
                      className="hidden"
                    />
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
                  {/* Background color */}
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
                  
                  {/* Environment */}
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
                  
                  {/* Scale */}
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
                  
                  {/* Toggle options */}
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
