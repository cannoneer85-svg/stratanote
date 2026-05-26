import React, { useState, useMemo, useRef, useEffect } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import { Search, ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';

interface Note {
  relative_path: string;
  title: string;
  is_directory: boolean;
  parent_path: string;
}

interface GraphViewProps {
  notes: Note[];
  noteContents: Record<string, string>; // relative_path -> content
  onNoteSelect: (path: string) => void;
  activeNotePath: string | null;
}

export const GraphView: React.FC<GraphViewProps> = ({
  notes,
  noteContents,
  onNoteSelect,
  activeNotePath
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const graphRef = useRef<any>(null);

  // Parse links and construct graph data
  const graphData = useMemo(() => {
    const noteFiles = notes.filter(n => !n.is_directory);
    const nodes = noteFiles.map(note => ({
      id: note.relative_path,
      name: note.title,
      val: 1, // Default size
      isCurrent: note.relative_path === activeNotePath
    }));

    const links: { source: string; target: string }[] = [];

    noteFiles.forEach(note => {
      const content = noteContents[note.relative_path] || '';
      // Regex to find wiki-links like [[RelativePath]] or [[RelativePath|Custom Label]]
      const wikiLinkRegex = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
      let match;

      while ((match = wikiLinkRegex.exec(content)) !== null) {
        let targetPath = match[1].trim();

        // Standardize file extension (Obsidian usually doesn't write .md in wikilinks)
        if (!targetPath.endsWith('.md')) {
          targetPath += '.md';
        }

        // Handle absolute or relative linking
        // First match exact path
        let targetNote = notes.find(n => n.relative_path.toLowerCase() === targetPath.toLowerCase());
        
        // If not found, try to match by basename (Obsidian matches loose notes if unique)
        if (!targetNote) {
          targetNote = notes.find(n => n.title.toLowerCase() === targetPath.replace(/\.md$/, '').toLowerCase());
        }

        if (targetNote && !targetNote.is_directory && targetNote.relative_path !== note.relative_path) {
          links.push({
            source: note.relative_path,
            target: targetNote.relative_path
          });
        }
      }
    });

    // Calculate link degrees to size nodes by backlink count
    const degrees: Record<string, number> = {};
    links.forEach(l => {
      degrees[l.source] = (degrees[l.source] || 0) + 1;
      degrees[l.target] = (degrees[l.target] || 0) + 1;
    });

    nodes.forEach(node => {
      node.val = 1 + (degrees[node.id] || 0) * 0.8; // Node size scale based on link count
    });

    return { nodes, links };
  }, [notes, noteContents, activeNotePath]);

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

  // Handle graph auto-zooming / fitting on load
  useEffect(() => {
    if (graphRef.current) {
      graphRef.current.d3Force('charge').strength(-150);
      graphRef.current.d3Force('link').distance(60);
      setTimeout(() => {
        graphRef.current.zoomToFit(400, 50);
      }, 500);
    }
  }, [graphData]);

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

  // Custom link renderer (HTML5 Canvas)
  const drawLink = (link: any, ctx: CanvasRenderingContext2D) => {
    const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
    const targetId = typeof link.target === 'object' ? link.target.id : link.target;

    const isHovered = hoverNode && (hoverNode.id === sourceId || hoverNode.id === targetId);

    if (hoverNode && !isHovered) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
      ctx.lineWidth = 0.5;
    } else {
      ctx.strokeStyle = isHovered ? '#a78bfa' : 'rgba(255, 255, 255, 0.12)';
      ctx.lineWidth = isHovered ? 1.5 : 0.8;
    }

    ctx.beginPath();
    ctx.moveTo(link.source.x, link.source.y);
    ctx.lineTo(link.target.x, link.target.y);
    ctx.stroke();
  };

  return (
    <div className="relative w-full h-full bg-background-panel rounded-xl border border-white/5 overflow-hidden flex flex-col">
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
          onClick={() => graphRef.current?.zoomToFit(400, 50)}
          className="p-1.5 hover:bg-white/5 rounded text-text-muted hover:text-white transition-colors cursor-pointer"
          title="По размеру"
        >
          <Maximize2 className="w-4 h-4" />
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
            linkCanvasObject={drawLink}
            onNodeClick={(node: any) => onNoteSelect(node.id)}
            onNodeHover={(node: any) => setHoverNode(node)}
            backgroundColor="#181818"
            cooldownTicks={100}
          />
        )}
      </div>
    </div>
  );
};
