import React, { useState, useMemo, useRef, useEffect } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import { Search, ZoomIn, ZoomOut, Maximize2, Minimize2, Focus } from 'lucide-react';
import { t, type Lang } from '../utils/translations';

interface Note {
  relative_path: string;
  title: string;
  is_directory: boolean;
  parent_path: string;
  created_by?: string;
}

interface GraphViewProps {
  notes: Note[];
  onNoteSelect: (path: string) => void;
  activeNotePath: string | null;
  lang: Lang;
}

export const GraphView: React.FC<GraphViewProps> = ({
  notes,
  onNoteSelect,
  activeNotePath,
  lang
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const graphRef = useRef<any>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [graphData, setGraphData] = useState<{ nodes: any[]; links: any[] }>({ nodes: [], links: [] });
  const hasInitialFit = useRef(false);

  // States for semantic graph filtering
  const [showWikiLinks, setShowWikiLinks] = useState(true);
  const [showSemanticLinks, setShowSemanticLinks] = useState(true);
  const [similarityThreshold, setSimilarityThreshold] = useState(0.85); // Default similarity threshold 85%
  const [excludedFolders, setExcludedFolders] = useState<Set<string>>(new Set());

  const handleSelectAllFolders = () => {
    setExcludedFolders(new Set());
    graphData.nodes.forEach((n: any) => {
      n.fx = undefined;
      n.fy = undefined;
    });
    hasInitialFit.current = false;
    if (graphRef.current) {
      graphRef.current.d3ReheatSimulation();
    }
  };

  const handleDeselectAllFolders = () => {
    const allPaths: string[] = [];
    folderTree.forEach(parent => {
      if (parent.subfolders) {
        parent.subfolders.forEach(sub => allPaths.push(sub.path));
      } else {
        allPaths.push(parent.path);
      }
    });
    setExcludedFolders(new Set(allPaths));
    graphData.nodes.forEach((n: any) => {
      n.fx = undefined;
      n.fy = undefined;
    });
    hasInitialFit.current = false;
    if (graphRef.current) {
      graphRef.current.d3ReheatSimulation();
    }
  };

  // Helper to extract display folder names (with subfolders support for _sources)
  const getDisplayFolder = (id: string): string => {
    const parts = id.split('/');
    if (parts.length <= 1) return lang === 'en' ? 'Root' : 'Корень';
    if (parts[0] === '_sources' && parts.length > 2) {
      return `_sources/${parts[1]}`;
    }
    return parts[0];
  };

  // Dynamically extract all display folders present in the data
  const allFolders = useMemo(() => {
    const folders = new Set<string>();
    graphData.nodes.forEach((n: any) => {
      folders.add(getDisplayFolder(n.id));
    });
    return Array.from(folders).sort();
  }, [graphData.nodes]);

  // Construct hierarchical folder tree
  const folderTree = useMemo(() => {
    const tree: { name: string; path: string; subfolders?: { name: string; path: string }[] }[] = [];
    const groups: Record<string, string[]> = {};
    
    allFolders.forEach(folder => {
      if (folder.startsWith('_sources/')) {
        const sub = folder.substring('_sources/'.length);
        if (!groups['_sources']) groups['_sources'] = [];
        groups['_sources'].push(sub);
      } else {
        if (!groups[folder]) groups[folder] = [];
      }
    });

    Object.keys(groups).forEach(key => {
      if (key === '_sources') {
        tree.push({
          name: '_sources',
          path: '_sources',
          subfolders: groups[key].map(sub => ({
            name: sub,
            path: `_sources/${sub}`
          }))
        });
      } else {
        tree.push({
          name: key,
          path: key
        });
      }
    });

    return tree;
  }, [allFolders]);

  // Filter nodes based on folder exclusions
  const filteredNodes = useMemo(() => {
    return graphData.nodes.filter((node: any) => {
      return !excludedFolders.has(getDisplayFolder(node.id));
    });
  }, [graphData.nodes, excludedFolders]);

  // Filter links dynamically based on user selections AND folder exclusions
  const filteredLinks = useMemo(() => {
    const nodeIds = new Set(filteredNodes.map(n => n.id));
    
    // 1. Separate wiki links and semantic candidates
    const wikiLinks: any[] = [];
    const semanticCandidates: any[] = [];
    
    graphData.links.forEach((l: any) => {
      const sourceId = typeof l.source === 'object' ? l.source.id : l.source;
      const targetId = typeof l.target === 'object' ? l.target.id : l.target;
      
      // Both source and target must be visible nodes
      if (!nodeIds.has(sourceId) || !nodeIds.has(targetId)) {
        return;
      }
      
      if (l.isSemantic) {
        if (showSemanticLinks && l.similarity >= similarityThreshold) {
          semanticCandidates.push(l);
        }
      } else {
        if (showWikiLinks) {
          wikiLinks.push(l);
        }
      }
    });
    
    // 2. Limit semantic links to Top-3 strongest connections per node to prevent rendering "hairballs" and lag
    const topSemanticLinks = new Set<any>();
    const nodeSemanticLinks: Record<string, any[]> = {};
    
    semanticCandidates.forEach((l: any) => {
      const sourceId = typeof l.source === 'object' ? l.source.id : l.source;
      const targetId = typeof l.target === 'object' ? l.target.id : l.target;
      
      if (!nodeSemanticLinks[sourceId]) nodeSemanticLinks[sourceId] = [];
      if (!nodeSemanticLinks[targetId]) nodeSemanticLinks[targetId] = [];
      
      nodeSemanticLinks[sourceId].push(l);
      nodeSemanticLinks[targetId].push(l);
    });
    
    Object.keys(nodeSemanticLinks).forEach(nodeId => {
      const links = nodeSemanticLinks[nodeId];
      // Sort in descending order of similarity
      links.sort((a, b) => b.similarity - a.similarity);
      // Keep only top 3 connections
      const topK = links.slice(0, 3);
      topK.forEach(l => topSemanticLinks.add(l));
    });
    
    return [...wikiLinks, ...Array.from(topSemanticLinks)];
  }, [graphData.links, filteredNodes, showWikiLinks, showSemanticLinks, similarityThreshold]);

  // Dynamically calculate link degrees based only on visible (filtered) links
  const visibleDegrees = useMemo(() => {
    const degrees: Record<string, number> = {};
    filteredLinks.forEach((l: any) => {
      const sourceId = typeof l.source === 'object' ? l.source.id : l.source;
      const targetId = typeof l.target === 'object' ? l.target.id : l.target;
      
      if (l.isSemantic) {
        // Semantic links count less (0.15) for both nodes since they are dense and symmetric
        degrees[sourceId] = (degrees[sourceId] || 0) + 0.15;
        degrees[targetId] = (degrees[targetId] || 0) + 0.15;
      } else {
        // Wiki links count 1.0 (backlinks count on the target node)
        degrees[targetId] = (degrees[targetId] || 0) + 1.0;
      }
    });
    return degrees;
  }, [filteredLinks]);

  // Safe zoom-to-fit that utilizes custom framing for small graphs and D3 fit for larger ones
  const triggerClampedFit = () => {
    if (!graphRef.current) return;
    const nodes = graphData.nodes;
    const nodeCount = nodes.length;
    if (nodeCount === 0) return;

    // Filter nodes with valid coordinates calculated by physics engine
    const validNodes = nodes.filter(n => n.x !== undefined && n.y !== undefined);
    if (validNodes.length === 0) {
      // Fallback if coordinates are not fully layouted yet
      graphRef.current.zoomToFit(400, 30);
      return;
    }

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    validNodes.forEach(n => {
      if (n.x < minX) minX = n.x;
      if (n.x > maxX) maxX = n.x;
      if (n.y < minY) minY = n.y;
      if (n.y > maxY) maxY = n.y;
    });

    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    if (nodeCount <= 5) {
      // Center precisely on the cluster's true geometric center and zoom to 1.5
      graphRef.current.centerAt(centerX, centerY, 400);
      graphRef.current.zoom(1.5, 400);
    } else {
      graphRef.current.zoomToFit(400, 30);
    }
  };

  // Reset initial fit flag when graph data changes
  useEffect(() => {
    hasInitialFit.current = false;
  }, [graphData]);

  // Center camera on the active note when it changes, preserving the user's current zoom scale
  useEffect(() => {
    if (graphRef.current && activeNotePath && filteredNodes.length > 0) {
      const node = filteredNodes.find(n => n.id === activeNotePath);
      if (node && node.x !== undefined && node.y !== undefined) {
        // Center the camera on the selected node coordinate with a smooth transition
        graphRef.current.centerAt(node.x, node.y, 450);
      }
    }
  }, [activeNotePath]);

  const toggleFullscreen = () => {
    const nextFullscreen = !isFullscreen;
    setIsFullscreen(nextFullscreen);
    hasInitialFit.current = false;
    // Let CSS transition (300ms) complete fully, then center beautifully
    setTimeout(() => {
      triggerClampedFit();
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
          // Unfreeze nodes so D3 can calculate initial force layout
          const nodes = data.nodes.map((node: any) => ({
            ...node,
            fx: undefined,
            fy: undefined
          }));

          setGraphData({ nodes, links: data.links });
        }
      } catch (err) {
        console.error('Error fetching graph data:', err);
      }
    };

    fetchGraphData();
  }, [notes]);

  // Track hovered node and its neighbors
  const [hoverNode, setHoverNode] = useState<any>(null);
  const hoverNeighbors = useMemo(() => {
    const neighbors = new Set<string>();
    if (hoverNode) {
      filteredLinks.forEach(link => {
        const sourceId = typeof link.source === 'object' ? (link.source as any).id : link.source;
        const targetId = typeof link.target === 'object' ? (link.target as any).id : link.target;
        if (sourceId === hoverNode.id) neighbors.add(targetId);
        if (targetId === hoverNode.id) neighbors.add(sourceId);
      });
    }
    return neighbors;
  }, [hoverNode, filteredLinks]);

  // Identify mutual links to curve them
  const mutualLinks = useMemo(() => {
    const mutual = new Set<string>();
    const linkSet = new Set<string>();
    
    filteredLinks.forEach(link => {
      const s = typeof link.source === 'object' ? link.source.id : link.source;
      const t = typeof link.target === 'object' ? link.target.id : link.target;
      linkSet.add(`${s}->${t}`);
    });

    filteredLinks.forEach(link => {
      const s = typeof link.source === 'object' ? link.source.id : link.source;
      const t = typeof link.target === 'object' ? link.target.id : link.target;
      if (linkSet.has(`${t}->${s}`)) {
        mutual.add(`${s}->${t}`);
      }
    });

    return mutual;
  }, [filteredLinks]);


  // Handle graph auto-zooming / fitting on load
  useEffect(() => {
    if (graphRef.current) {
      const nodeCount = graphData.nodes.length;
      // Dynamically space nodes to look beautiful and avoid clipping:
      // Spreading few nodes far apart makes the bounding box naturally larger,
      // which results in beautiful framing without having to zoom in too close!
      const linkDistance = nodeCount <= 2 ? 180 : nodeCount <= 5 ? 120 : 80;
      const chargeStrength = nodeCount <= 2 ? -400 : nodeCount <= 5 ? -300 : -200;

      graphRef.current.d3Force('charge')
        .strength(chargeStrength)
        .distanceMax(300);
      graphRef.current.d3Force('link').distance(linkDistance);
      
      // Reheat the force simulation to let the nodes spread out beautifully
      graphRef.current.d3ReheatSimulation();
    }
  }, [graphData]);

  // Handle engine stop to fit the graph to the container perfectly once fully stabilized
  const handleEngineStop = () => {
    if (!hasInitialFit.current && graphData.nodes.length > 0) {
      triggerClampedFit();
      hasInitialFit.current = true;
    }
    
    // Freeze all nodes in their current positions to prevent them from moving
    // when links or threshold change
    graphData.nodes.forEach(node => {
      if (node.x !== undefined && node.fx === undefined) {
        node.fx = node.x;
        node.fy = node.y;
      }
    });
  };

  // Custom node renderer (HTML5 Canvas)
  const drawNode = (node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
    const isHighlighted = searchQuery && node.name.toLowerCase().includes(searchQuery.toLowerCase());
    const isHovered = hoverNode === node;
    const isNeighbor = hoverNeighbors.has(node.id);
    const isActive = node.id === activeNotePath;

    // Logarithmic scaling based on visible connections count to keep layout compact and clean
    const degreeCount = visibleDegrees[node.id] || 0;
    const baseRadius = Math.max(3.5, 3.5 + Math.log1p(degreeCount) * 2.2);
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

    // Node Text Label (render only if zoomed in enough or if node is active/highlighted/hovered)
    const showLabel = globalScale > 0.85 || isActive || isHighlighted || isHovered || isNeighbor;
    if (showLabel) {
      const label = node.name;
      // Cap maximum font size at 11px to prevent huge letters when zooming out
      const fontSize = Math.min(11, Math.max(4, 9 / Math.sqrt(globalScale)));
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
    }
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
            placeholder={lang === 'en' ? 'Search notes on graph...' : 'Поиск заметок на графе...'}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-1.5 bg-black/40 border border-white/5 rounded-lg text-xs text-text placeholder-text-disabled focus:outline-none focus:border-primary/50 transition-colors"
          />
        </div>

        {/* Semantic Graph Settings */}
        <div className="bg-black/60 backdrop-blur-md border border-white/5 p-3 rounded-lg flex flex-col space-y-2 w-64 text-xs text-text">
          <div className="font-semibold text-text-muted border-b border-white/5 pb-1 select-none">
            {lang === 'en' ? 'Connections on graph:' : 'Связи на графе:'}
          </div>
          
          <label className="flex items-center space-x-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showWikiLinks}
              onChange={(e) => setShowWikiLinks(e.target.checked)}
              className="accent-primary rounded cursor-pointer"
            />
            <span>{t('graph_toggle_wiki', lang)}</span>
          </label>

          <label className="flex items-center space-x-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showSemanticLinks}
              onChange={(e) => setShowSemanticLinks(e.target.checked)}
              className="accent-purple-500 rounded cursor-pointer"
            />
            <span>{t('graph_toggle_semantic', lang)}</span>
          </label>

          {showSemanticLinks && (
            <div className="flex flex-col space-y-1.5 pt-1.5 border-t border-white/5">
              <div className="flex justify-between text-[10px] text-text-muted select-none">
                <span>{t('graph_threshold', lang)}:</span>
                <span className="font-mono text-purple-400 font-semibold">{(similarityThreshold * 100).toFixed(0)}%</span>
              </div>
              <input
                type="range"
                min="0.50"
                max="0.95"
                step="0.05"
                value={similarityThreshold}
                onChange={(e) => setSimilarityThreshold(parseFloat(e.target.value))}
                className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-purple-500"
              />
            </div>
          )}

          {/* Folders Filter Section */}
          <div className="flex flex-col space-y-1.5 pt-1.5 border-t border-white/5">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-text-muted select-none">
                {lang === 'en' ? 'Folders:' : 'Каталоги:'}
              </span>
              <div className="flex items-center space-x-2 text-[10px]">
                <button
                  onClick={handleSelectAllFolders}
                  className="text-primary hover:underline cursor-pointer font-medium"
                >
                  {t('graph_select_all', lang)}
                </button>
                <span className="text-white/20 select-none">|</span>
                <button
                  onClick={handleDeselectAllFolders}
                  className="text-text-muted hover:text-white hover:underline cursor-pointer font-medium"
                >
                  {t('graph_deselect_all', lang)}
                </button>
              </div>
            </div>
            <div className="max-h-36 overflow-y-auto space-y-1.5 pr-1 border border-white/5 rounded p-1.5 bg-black/20">
              {folderTree.map(parent => {
                const isParent = !!parent.subfolders;
                if (isParent) {
                  const subfolders = parent.subfolders || [];
                  const visibleSubs = subfolders.filter(sub => !excludedFolders.has(sub.path));
                  const isChecked = visibleSubs.length > 0;
                  
                  return (
                    <div key={parent.path} className="flex flex-col space-y-1">
                      {/* Parent Checkbox */}
                      <label className="flex items-center space-x-2 cursor-pointer select-none text-[10px] font-semibold text-text-muted hover:text-text">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => {
                            const newExcludes = new Set(excludedFolders);
                            if (isChecked) {
                              // Turn OFF parent: exclude all subfolders
                              subfolders.forEach(sub => newExcludes.add(sub.path));
                            } else {
                              // Turn ON parent: include all subfolders (remove from excludes)
                              subfolders.forEach(sub => newExcludes.delete(sub.path));
                            }
                            setExcludedFolders(newExcludes);
                            // Unfreeze all nodes so D3 simulation can rearrange them beautifully
                            graphData.nodes.forEach((n: any) => {
                              n.fx = undefined;
                              n.fy = undefined;
                            });
                            hasInitialFit.current = false;
                            if (graphRef.current) {
                              graphRef.current.d3ReheatSimulation();
                            }
                          }}
                          className="accent-purple-500 rounded cursor-pointer scale-75"
                        />
                        <span className="truncate" title={parent.name}>{parent.name}</span>
                      </label>
                      
                      {/* Subfolders List */}
                      <div className="flex flex-col space-y-1 pl-4 border-l border-white/5 ml-1.5 py-0.5">
                        {subfolders.map((sub, idx) => {
                          const isSubChecked = !excludedFolders.has(sub.path);
                          const isLast = idx === subfolders.length - 1;
                          return (
                            <label key={sub.path} className="flex items-center space-x-1.5 cursor-pointer select-none text-[9px] text-text-muted hover:text-text">
                              <span className="text-white/20 select-none font-mono">{isLast ? '└─' : '├─'}</span>
                              <input
                                type="checkbox"
                                checked={isSubChecked}
                                onChange={() => {
                                  const newExcludes = new Set(excludedFolders);
                                  if (isSubChecked) {
                                    newExcludes.add(sub.path);
                                  } else {
                                    newExcludes.delete(sub.path);
                                  }
                                  setExcludedFolders(newExcludes);
                                  // Unfreeze all nodes
                                  graphData.nodes.forEach((n: any) => {
                                    n.fx = undefined;
                                    n.fy = undefined;
                                  });
                                  hasInitialFit.current = false;
                                  if (graphRef.current) {
                                    graphRef.current.d3ReheatSimulation();
                                  }
                                }}
                                className="accent-primary rounded cursor-pointer scale-75"
                              />
                              <span className="truncate" title={sub.name}>{sub.name}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  );
                } else {
                  // Normal Folder without subfolders
                  const isChecked = !excludedFolders.has(parent.path);
                  return (
                    <label key={parent.path} className="flex items-center space-x-2 cursor-pointer select-none text-[10px]">
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => {
                          const newExcludes = new Set(excludedFolders);
                          if (isChecked) {
                            newExcludes.add(parent.path);
                          } else {
                            newExcludes.delete(parent.path);
                          }
                          setExcludedFolders(newExcludes);
                          // Unfreeze all nodes
                          graphData.nodes.forEach((n: any) => {
                            n.fx = undefined;
                            n.fy = undefined;
                          });
                          hasInitialFit.current = false;
                          if (graphRef.current) {
                            graphRef.current.d3ReheatSimulation();
                          }
                        }}
                        className="accent-primary rounded cursor-pointer scale-75"
                      />
                      <span className="truncate" title={parent.name}>{parent.name}</span>
                    </label>
                  );
                }
              })}
            </div>
          </div>

          {/* Statistics Info */}
          <div className="flex justify-between items-center text-[10px] text-text-muted pt-2 border-t border-white/5 select-none font-mono">
            <span>{lang === 'en' ? 'Nodes' : 'Узлов'}: <strong className="text-white">{filteredNodes.length}</strong></span>
            <span>{lang === 'en' ? 'Links' : 'Связей'}: <strong className="text-purple-400">{filteredLinks.length}</strong></span>
          </div>
        </div>
      </div>

      <div className="absolute top-4 right-4 z-10 flex space-x-2 bg-black/40 border border-white/5 p-1 rounded-lg">
        <button
          onClick={() => graphRef.current?.zoom(graphRef.current.zoom() * 1.3, 300)}
          className="p-1.5 hover:bg-white/5 rounded text-text-muted hover:text-white transition-colors cursor-pointer"
          title={lang === 'en' ? 'Zoom In' : 'Приблизить'}
        >
          <ZoomIn className="w-4 h-4" />
        </button>
        <button
          onClick={() => graphRef.current?.zoom(graphRef.current.zoom() / 1.3, 300)}
          className="p-1.5 hover:bg-white/5 rounded text-text-muted hover:text-white transition-colors cursor-pointer"
          title={lang === 'en' ? 'Zoom Out' : 'Отдалить'}
        >
          <ZoomOut className="w-4 h-4" />
        </button>
        <button
          onClick={() => triggerClampedFit()}
          className="p-1.5 hover:bg-white/5 rounded text-text-muted hover:text-white transition-colors cursor-pointer"
          title={lang === 'en' ? 'Fit to Canvas (Reset Zoom)' : 'По размеру (Сбросить зум)'}
        >
          <Focus className="w-4 h-4" />
        </button>
        <button
          onClick={toggleFullscreen}
          className="p-1.5 hover:bg-white/5 rounded text-text-muted hover:text-white transition-colors cursor-pointer border-l border-white/10 pl-2 ml-1"
          title={isFullscreen ? (lang === 'en' ? 'Exit Fullscreen' : 'Свернуть') : (lang === 'en' ? 'Fullscreen' : 'Развернуть на весь экран')}
        >
          {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
        </button>
      </div>

      {/* React Force Graph Canvas Container */}
      <div className="flex-1 w-full h-full relative cursor-grab active:cursor-grabbing select-none">
        {graphData.nodes.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center text-text-muted text-sm">
            {lang === 'en' ? 'No notes to display connections graph.' : 'Нет заметок для отображения графа связей.'}
          </div>
        ) : (
          <ForceGraph2D
            ref={graphRef}
            graphData={{ nodes: filteredNodes, links: filteredLinks }}
            nodeCanvasObject={drawNode}
            linkColor={(link: any) => {
              const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
              const targetId = typeof link.target === 'object' ? link.target.id : link.target;
              const isHovered = hoverNode && (hoverNode.id === sourceId || hoverNode.id === targetId);
              const isActive = activeNotePath && (activeNotePath === sourceId || activeNotePath === targetId);

              if (hoverNode) {
                if (isHovered) {
                  return link.isSemantic ? '#c084fc' : '#a78bfa';
                }
                return 'rgba(255, 255, 255, 0.02)';
              }
              if (activeNotePath) {
                if (isActive) {
                  return link.isSemantic ? '#c084fc' : '#9d4edd';
                }
                return 'rgba(255, 255, 255, 0.04)';
              }
              return link.isSemantic ? 'rgba(168, 85, 247, 0.35)' : 'rgba(255, 255, 255, 0.12)';
            }}
            linkWidth={(link: any) => {
              const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
              const targetId = typeof link.target === 'object' ? link.target.id : link.target;
              const isHovered = hoverNode && (hoverNode.id === sourceId || hoverNode.id === targetId);
              return isHovered ? (link.isSemantic ? 1.5 : 1.8) : (link.isSemantic ? 0.6 : 0.8);
            }}
            linkCurvature={(link: any) => {
              if (link.isSemantic) return 0.15; // slightly curve semantic links to separate them visually
              const s = typeof link.source === 'object' ? link.source.id : link.source;
              const t = typeof link.target === 'object' ? link.target.id : link.target;
              return mutualLinks.has(`${s}->${t}`) ? 0.25 : 0;
            }}
            linkLineDash={(link: any) => link.isSemantic ? [3, 2.5] : null}
            
            // Directional Arrows
            linkDirectionalArrowLength={(link: any) => {
              if (link.isSemantic) return 0; // semantic links are symmetric and undirected
              const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
              const targetId = typeof link.target === 'object' ? link.target.id : link.target;
              const isHovered = hoverNode && (hoverNode.id === sourceId || hoverNode.id === targetId);
              
              if (hoverNode && !isHovered) return 0; // Hide arrows on dimmed links
              return 3.5;
            }}
            linkDirectionalArrowColor={(link: any) => {
              if (link.isSemantic) return 'transparent';
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
                return isHovered ? 2 : 0; // Flow only on hovered connections
              }
              if (activeNotePath) {
                return isActive ? 1 : 0;
              }
              return link.isSemantic ? 0 : 0.6; // No default flow for semantic links to prevent clutter
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

              if (link.isSemantic) {
                return isHovered ? '#e9d5ff' : '#d8b4fe';
              }
              if (isHovered) return '#d8b4fe';
              if (isActive) return '#a78bfa';
              return 'rgba(255, 255, 255, 0.4)';
            }}

            nodeLabel={(node: any) => {
              let wikiLinksCount = 0;
              let semanticLinksCount = 0;
              
              filteredLinks.forEach((l: any) => {
                const sId = typeof l.source === 'object' ? l.source.id : l.source;
                const tId = typeof l.target === 'object' ? l.target.id : l.target;
                if (sId === node.id || tId === node.id) {
                  if (l.isSemantic) {
                    semanticLinksCount++;
                  } else {
                    wikiLinksCount++;
                  }
                }
              });
              
              const totalLinks = wikiLinksCount + semanticLinksCount;
              const filename = node.id.split('/').pop() || node.id;
              const title = filename.endsWith('.md') ? filename.slice(0, -3) : filename;

              return `<div style="background: rgba(18,18,18,0.95); border: 1px solid rgba(255,255,255,0.08); border-radius: 6px; padding: 8px 12px; color: #f3f4f6; font-size: 11px; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1); font-family: Inter, sans-serif; line-height: 1.4; pointer-events: none;">
                <div style="font-weight: 700; color: #ffffff; margin-bottom: 2px; font-size: 12px;">${title}</div>
                <div style="color: #9ca3af; font-size: 9px; margin-bottom: 6px; font-family: monospace; word-break: break-all;">${node.id}</div>
                <div style="border-top: 1px solid rgba(255,255,255,0.08); padding-top: 6px; margin-top: 6px; display: flex; flex-direction: column; gap: 2px;">
                  <div>Всего связей: <span style="font-weight: 700; color: #fff;">${totalLinks}</span></div>
                  <div style="color: #a78bfa;">• Вики-ссылки: <span style="font-weight: 700;">${wikiLinksCount}</span></div>
                  <div style="color: #c084fc;">• Логические связи: <span style="font-weight: 700;">${semanticLinksCount}</span></div>
                </div>
              </div>`;
            }}

            linkLabel={(link: any) => {
              if (link.isSemantic) {
                return `<div style="background: rgba(18,18,18,0.95); border: 1px solid rgba(168,85,247,0.4); border-radius: 6px; padding: 6px 10px; color: #f3f4f6; font-size: 11px; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1); font-family: Inter, sans-serif; pointer-events: none;">
                  <span style="color: #c084fc; font-weight: 600;">Логическая семантическая связь</span><br/>
                  Сходство текстов: <span style="font-family: monospace; color: #a855f7; font-weight: 700;">${(link.similarity * 100).toFixed(0)}%</span>
                </div>`;
              }
              return '';
            }}

            onNodeClick={(node: any) => onNoteSelect(node.id)}
            onNodeHover={(node: any) => setHoverNode(node)}
            onNodeDragEnd={(node: any) => {
              node.fx = node.x;
              node.fy = node.y;
            }}
            onEngineStop={handleEngineStop}
            backgroundColor="#181818"
            cooldownTicks={100}
            maxZoom={40}
            minZoom={0.1}
          />
        )}
      </div>
    </div>
  );
};
