import React, { useState, useMemo, useRef, useEffect } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import { Search, ZoomIn, ZoomOut, Maximize2, Minimize2, Focus } from 'lucide-react';

interface Note {
  relative_path: string;
  title: string;
  is_directory: boolean;
  parent_path: string;
}

interface GraphViewProps {
  notes: Note[];
  onNoteSelect: (path: string) => void;
  activeNotePath: string | null;
}

export const GraphView: React.FC<GraphViewProps> = ({
  notes,
  onNoteSelect,
  activeNotePath
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const graphRef = useRef<any>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [graphData, setGraphData] = useState<{ nodes: any[]; links: any[] }>({ nodes: [], links: [] });
  const hasInitialFit = useRef(false);

  // Safe zoom-to-fit that utilizes D3's native maxZoom limit constraint
  const triggerClampedFit = (padding: number) => {
    graphRef.current?.zoomToFit(400, padding);
  };

  // Reset initial fit flag when graph data changes
  useEffect(() => {
    hasInitialFit.current = false;
  }, [graphData]);

  const toggleFullscreen = () => {
    const nextFullscreen = !isFullscreen;
    setIsFullscreen(nextFullscreen);
    hasInitialFit.current = false;
    // Let CSS transition (300ms) complete fully, then center beautifully
    setTimeout(() => {
      triggerClampedFit(nextFullscreen ? 80 : 115);
    }, 350);
  };

  // Fetch complete note relations from server dynamically
  useEffect(() => {
    const fetchGraphData = async () => {
      try {
        const token = localStorage.getItem('token');
        const res = await fetch('/api/notes/graph-data', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        
        if (res.ok) {
          // Calculate link degrees to size nodes by backlink count (incoming links only)
          const degrees: Record<string, number> = {};
          data.links.forEach((l: any) => {
            const targetId = typeof l.target === 'object' ? l.target.id : l.target;
            degrees[targetId] = (degrees[targetId] || 0) + 1;
          });

          const nodes = data.nodes.map((node: any) => ({
            ...node,
            val: 1 + (degrees[node.id] || 0) * 0.8,
            isCurrent: node.id === activeNotePath
          }));

          setGraphData({ nodes, links: data.links });
        }
      } catch (err) {
        console.error('Error fetching graph data:', err);
      }
    };

    fetchGraphData();
  }, [notes, activeNotePath]);

  // Track hovered node and its neighbors
  const [hoverNode, setHoverNode] = useState<any>(null);
  const hoverNeighbors = useMemo(() => {
    const neighbors = new Set<string>();
    if (hoverNode) {
      graphData.links.forEach(link => {
        const sourceId = typeof link.source === 'object' ? (link.source as any).id : link.source;
        const targetId = typeof link.target === 'object' ? (link.target as any).id : link.target;
        if (sourceId === hoverNode.id) neighbors.add(targetId);
        if (targetId === hoverNode.id) neighbors.add(sourceId);
      });
    }
    return neighbors;
  }, [hoverNode, graphData]);

  // Identify mutual links to curve them
  const mutualLinks = useMemo(() => {
    const mutual = new Set<string>();
    const linkSet = new Set<string>();
    
    graphData.links.forEach(link => {
      const s = typeof link.source === 'object' ? link.source.id : link.source;
      const t = typeof link.target === 'object' ? link.target.id : link.target;
      linkSet.add(`${s}->${t}`);
    });

    graphData.links.forEach(link => {
      const s = typeof link.source === 'object' ? link.source.id : link.source;
      const t = typeof link.target === 'object' ? link.target.id : link.target;
      if (linkSet.has(`${t}->${s}`)) {
        mutual.add(`${s}->${t}`);
      }
    });

    return mutual;
  }, [graphData.links]);


  // Handle graph auto-zooming / fitting on load
  useEffect(() => {
    if (graphRef.current) {
      const nodeCount = graphData.nodes.length;
      // Dynamically space nodes to look beautiful and avoid clipping:
      // Spreading few nodes far apart makes the bounding box naturally larger,
      // which results in beautiful framing without having to zoom in too close!
      const linkDistance = nodeCount <= 2 ? 140 : nodeCount <= 4 ? 90 : 60;
      const chargeStrength = nodeCount <= 2 ? -250 : nodeCount <= 4 ? -180 : -150;

      graphRef.current.d3Force('charge').strength(chargeStrength);
      graphRef.current.d3Force('link').distance(linkDistance);
      
      // Reheat the force simulation to let the nodes spread out beautifully
      graphRef.current.d3ReheatSimulation();
    }
  }, [graphData]);

  // Handle engine stop to fit the graph to the container perfectly once fully stabilized
  const handleEngineStop = () => {
    if (!hasInitialFit.current && graphData.nodes.length > 0) {
      triggerClampedFit(isFullscreen ? 80 : 115);
      hasInitialFit.current = true;
    }
  };

  // Custom node renderer (HTML5 Canvas)
  const drawNode = (node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
    const isHighlighted = searchQuery && node.name.toLowerCase().includes(searchQuery.toLowerCase());
    const isHovered = hoverNode === node;
    const isNeighbor = hoverNeighbors.has(node.id);
    const isActive = node.id === activeNotePath;

    const baseRadius = Math.max(3, Math.sqrt(node.val) * 2.5);
    let radius = baseRadius;

    // Draw shadow glow for active/searched/hovered
    if (isActive || isHighlighted || isHovered) {
      ctx.shadowColor = isActive ? '#9d4edd' : isHighlighted ? '#f59e0b' : '#a78bfa';
      ctx.shadowBlur = 15;
      radius = baseRadius * 1.25;
    } else {
      ctx.shadowBlur = 0;
    }

    // Set colors
    if (isActive) {
      ctx.fillStyle = '#9d4edd'; // Purple active
    } else if (isHighlighted) {
      ctx.fillStyle = '#f59e0b'; // Amber search match
    } else if (hoverNode && !isHovered && !isNeighbor) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.15)'; // Faded out
    } else {
      ctx.fillStyle = isHovered ? '#a78bfa' : '#e0e0e0'; // Normal white/light gray
    }

    // Draw circle
    ctx.beginPath();
    ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI, false);
    ctx.fill();

    // Reset shadow
    ctx.shadowBlur = 0;

    // Node Text Label
    const label = node.name;
    const fontSize = Math.max(3.5, 10 / Math.sqrt(globalScale));
    ctx.font = `${fontSize}px Outfit, Inter, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    // Label opacity
    let textStyle = 'rgba(224, 224, 224, 0.8)';
    if (isActive) textStyle = '#ffffff';
    else if (isHighlighted) textStyle = '#f59e0b';
    else if (hoverNode && !isHovered && !isNeighbor) textStyle = 'rgba(255, 255, 255, 0.1)';

    ctx.fillStyle = textStyle;
    ctx.fillText(label, node.x, node.y + radius + 2);
  };



  return (
    <div className={`
      bg-background-panel border border-white/5 flex flex-col transition-all duration-300
      ${isFullscreen 
        ? 'fixed inset-0 z-50 p-6 bg-[#121212]' 
        : 'relative w-full h-full rounded-xl overflow-hidden'
      }
    `}>
      {/* Controls Overlay */}
      <div className="absolute top-4 left-4 z-10 flex flex-col space-y-2">
        <div className="relative w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
          <input
            type="text"
            placeholder="Поиск заметок на графе..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-1.5 bg-black/40 border border-white/5 rounded-lg text-xs text-text placeholder-text-disabled focus:outline-none focus:border-primary/50 transition-colors"
          />
        </div>
      </div>

      <div className="absolute top-4 right-4 z-10 flex space-x-2 bg-black/40 border border-white/5 p-1 rounded-lg">
        <button
          onClick={() => graphRef.current?.zoom(graphRef.current.zoom() * 1.3, 300)}
          className="p-1.5 hover:bg-white/5 rounded text-text-muted hover:text-white transition-colors cursor-pointer"
          title="Приблизить"
        >
          <ZoomIn className="w-4 h-4" />
        </button>
        <button
          onClick={() => graphRef.current?.zoom(graphRef.current.zoom() / 1.3, 300)}
          className="p-1.5 hover:bg-white/5 rounded text-text-muted hover:text-white transition-colors cursor-pointer"
          title="Отдалить"
        >
          <ZoomOut className="w-4 h-4" />
        </button>
        <button
          onClick={() => triggerClampedFit(isFullscreen ? 80 : 115)}
          className="p-1.5 hover:bg-white/5 rounded text-text-muted hover:text-white transition-colors cursor-pointer"
          title="По размеру (Сбросить зум)"
        >
          <Focus className="w-4 h-4" />
        </button>
        <button
          onClick={toggleFullscreen}
          className="p-1.5 hover:bg-white/5 rounded text-text-muted hover:text-white transition-colors cursor-pointer border-l border-white/10 pl-2 ml-1"
          title={isFullscreen ? "Свернуть" : "Развернуть на весь экран"}
        >
          {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
        </button>
      </div>

      {/* React Force Graph Canvas Container */}
      <div className="flex-1 w-full h-full relative cursor-grab active:cursor-grabbing select-none">
        {graphData.nodes.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center text-text-muted text-sm">
            Нет заметок для отображения графа связей.
          </div>
        ) : (
          <ForceGraph2D
            ref={graphRef}
            graphData={graphData}
            nodeCanvasObject={drawNode}
            linkColor={(link: any) => {
              const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
              const targetId = typeof link.target === 'object' ? link.target.id : link.target;
              const isHovered = hoverNode && (hoverNode.id === sourceId || hoverNode.id === targetId);
              const isActive = activeNotePath && (activeNotePath === sourceId || activeNotePath === targetId);

              if (hoverNode) {
                return isHovered ? '#a78bfa' : 'rgba(255, 255, 255, 0.02)';
              }
              if (activeNotePath) {
                return isActive ? '#9d4edd' : 'rgba(255, 255, 255, 0.05)';
              }
              return 'rgba(255, 255, 255, 0.12)';
            }}
            linkWidth={(link: any) => {
              const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
              const targetId = typeof link.target === 'object' ? link.target.id : link.target;
              const isHovered = hoverNode && (hoverNode.id === sourceId || hoverNode.id === targetId);
              return isHovered ? 1.8 : 0.8;
            }}
            linkCurvature={(link: any) => {
              const s = typeof link.source === 'object' ? link.source.id : link.source;
              const t = typeof link.target === 'object' ? link.target.id : link.target;
              return mutualLinks.has(`${s}->${t}`) ? 0.25 : 0;
            }}
            
            // Directional Arrows
            linkDirectionalArrowLength={(link: any) => {
              const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
              const targetId = typeof link.target === 'object' ? link.target.id : link.target;
              const isHovered = hoverNode && (hoverNode.id === sourceId || hoverNode.id === targetId);
              
              if (hoverNode && !isHovered) return 0; // Hide arrows on dimmed links
              return 3.5;
            }}
            linkDirectionalArrowColor={(link: any) => {
              const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
              const targetId = typeof link.target === 'object' ? link.target.id : link.target;
              const isHovered = hoverNode && (hoverNode.id === sourceId || hoverNode.id === targetId);
              const isActive = activeNotePath && (activeNotePath === sourceId || activeNotePath === targetId);

              if (isHovered) return '#a78bfa';
              if (isActive) return '#9d4edd';
              return 'rgba(255, 255, 255, 0.25)';
            }}
            linkDirectionalArrowRelPos={0.95} // Position near target node edge
            
            // Glowing Flow Particles (Living Graph)
            linkDirectionalParticles={(link: any) => {
              const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
              const targetId = typeof link.target === 'object' ? link.target.id : link.target;
              const isHovered = hoverNode && (hoverNode.id === sourceId || hoverNode.id === targetId);
              const isActive = activeNotePath && (activeNotePath === sourceId || activeNotePath === targetId);

              if (hoverNode) {
                return isHovered ? 3 : 0; // Flow only on hovered connections
              }
              if (activeNotePath) {
                return isActive ? 2 : 0;
              }
              return 1; // Subtle background flow
            }}
            linkDirectionalParticleSpeed={(link: any) => {
              const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
              const targetId = typeof link.target === 'object' ? link.target.id : link.target;
              const isHovered = hoverNode && (hoverNode.id === sourceId || hoverNode.id === targetId);
              return isHovered ? 0.008 : 0.003;
            }}
            linkDirectionalParticleWidth={(link: any) => {
              const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
              const targetId = typeof link.target === 'object' ? link.target.id : link.target;
              const isHovered = hoverNode && (hoverNode.id === sourceId || hoverNode.id === targetId);
              return isHovered ? 2.5 : 1.5;
            }}
            linkDirectionalParticleColor={(link: any) => {
              const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
              const targetId = typeof link.target === 'object' ? link.target.id : link.target;
              const isHovered = hoverNode && (hoverNode.id === sourceId || hoverNode.id === targetId);
              const isActive = activeNotePath && (activeNotePath === sourceId || activeNotePath === targetId);

              if (isHovered) return '#d8b4fe'; // Lavender glow
              if (isActive) return '#a78bfa'; // Purple glow
              return 'rgba(255, 255, 255, 0.4)';
            }}

            onNodeClick={(node: any) => onNoteSelect(node.id)}
            onNodeHover={(node: any) => setHoverNode(node)}
            onEngineStop={handleEngineStop}
            backgroundColor="#181818"
            cooldownTicks={100}
            maxZoom={2.5}
            minZoom={0.1}
          />
        )}
      </div>
    </div>
  );
};
