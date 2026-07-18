[**API Reference**](/api-reference/index) / [**GraphView**](/api-reference/components/GraphView/index)

***

> `const` **GraphView**: `React.FC`\<`GraphViewProps`\>

Defined in: [components/GraphView.tsx:34](https://github.com/cannoneer85-svg/stratanote/blob/master/_app/client/src/components/GraphView.tsx#L34)

Interactive notes connections graph component.
Uses a HTML5 Canvas force-directed graph (via `react-force-graph-2d` and D3.js)
to visualize wikilinks and semantic relationships between notes.
Supports pan, zoom, click node focus, folder filtering, and similarity threshold sliders.
