import type { ViewPort } from "react-zoomable-ui/dist/ViewPort";
import type { CanvasDirection } from "reaflow/dist/layout/elkLayout";
import { create } from "zustand";
import { SUPPORTED_LIMIT } from "../../../../../constants/graph";
import useJson from "../../../../../store/useJson";
import useFile from "../../../../../store/useFile";
import type { EdgeData, NodeData } from "../../../../../types/graph";
import { parser } from "../lib/jsonParser";
import { getChildrenEdges } from "../lib/utils/getChildrenEdges";
import { getOutgoers } from "../lib/utils/getOutgoers";

export interface Graph {
  viewPort: ViewPort | null;
  direction: CanvasDirection;
  loading: boolean;
  graphCollapsed: boolean;
  fullscreen: boolean;
  collapseAll: boolean;
  nodes: NodeData[];
  edges: EdgeData[];
  collapsedNodes: string[];
  collapsedEdges: string[];
  collapsedParents: string[];
  selectedNode: NodeData | null;
  path: string;
  aboveSupportedLimit: boolean;
}

const initialStates: Graph = {
  viewPort: null,
  direction: "RIGHT",
  loading: true,
  graphCollapsed: false,
  fullscreen: false,
  collapseAll: false,
  nodes: [],
  edges: [],
  collapsedNodes: [],
  collapsedEdges: [],
  collapsedParents: [],
  selectedNode: null,
  path: "",
  aboveSupportedLimit: false,
};

interface GraphActions {
  setGraph: (json?: string, options?: Partial<Graph>[]) => void;
  setLoading: (loading: boolean) => void;
  setDirection: (direction: CanvasDirection) => void;
  setViewPort: (ref: ViewPort) => void;
  setSelectedNode: (nodeData: NodeData) => void;
  focusFirstNode: () => void;
  expandNodes: (nodeId: string) => void;
  expandGraph: () => void;
  collapseNodes: (nodeId: string) => void;
  collapseGraph: () => void;
  getCollapsedNodeIds: () => string[];
  getCollapsedEdgeIds: () => string[];
  toggleFullscreen: (value: boolean) => void;
  toggleCollapseAll: (value: boolean) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  centerView: () => void;
  clearGraph: () => void;
  setZoomFactor: (zoomFactor: number) => void;
  updateNodeContent: (newContent: string) => void;
}

const useGraph = create<Graph & GraphActions>((set, get) => ({
  ...initialStates,
  toggleCollapseAll: collapseAll => {
    set({ collapseAll });
    get().collapseGraph();
  },
  clearGraph: () => set({ nodes: [], edges: [], loading: false }),
  getCollapsedNodeIds: () => get().collapsedNodes,
  getCollapsedEdgeIds: () => get().collapsedEdges,
  setSelectedNode: nodeData => set({ selectedNode: nodeData }),
  setGraph: (data, options) => {
    const { nodes, edges } = parser(data ?? useJson.getState().json);

    if (get().collapseAll) {
      if (nodes.length > SUPPORTED_LIMIT) {
        return set({ aboveSupportedLimit: true, ...options, loading: false });
      }

      set({ nodes, edges, aboveSupportedLimit: false, ...options });
      get().collapseGraph();
    } else {
      if (nodes.length > SUPPORTED_LIMIT) {
        return set({
          aboveSupportedLimit: true,
          collapsedParents: [],
          collapsedNodes: [],
          collapsedEdges: [],
          ...options,
          loading: false,
        });
      }

      set({
        nodes,
        edges,
        collapsedParents: [],
        collapsedNodes: [],
        collapsedEdges: [],
        graphCollapsed: false,
        aboveSupportedLimit: false,
        ...options,
      });
    }
  },
  setDirection: (direction = "RIGHT") => {
    set({ direction });
    setTimeout(() => get().centerView(), 200);
  },
  setLoading: loading => set({ loading }),
  expandNodes: nodeId => {
    const [childrenNodes, matchingNodes] = getOutgoers(
      nodeId,
      get().nodes,
      get().edges,
      get().collapsedParents
    );
    const childrenEdges = getChildrenEdges(childrenNodes, get().edges);

    const nodesConnectedToParent = childrenEdges.reduce((nodes: string[], edge) => {
      edge.from && !nodes.includes(edge.from) && nodes.push(edge.from);
      edge.to && !nodes.includes(edge.to) && nodes.push(edge.to);
      return nodes;
    }, []);
    const matchingNodesConnectedToParent = matchingNodes.filter(node =>
      nodesConnectedToParent.includes(node)
    );
    const nodeIds = childrenNodes.map(node => node.id).concat(matchingNodesConnectedToParent);
    const edgeIds = childrenEdges.map(edge => edge.id);

    const collapsedParents = get().collapsedParents.filter(cp => cp !== nodeId);
    const collapsedNodes = get().collapsedNodes.filter(nodeId => !nodeIds.includes(nodeId));
    const collapsedEdges = get().collapsedEdges.filter(edgeId => !edgeIds.includes(edgeId));

    set({
      collapsedParents,
      collapsedNodes,
      collapsedEdges,
      graphCollapsed: !!collapsedNodes.length,
    });
  },
  collapseNodes: nodeId => {
    const [childrenNodes] = getOutgoers(nodeId, get().nodes, get().edges);
    const childrenEdges = getChildrenEdges(childrenNodes, get().edges);

    const nodeIds = childrenNodes.map(node => node.id);
    const edgeIds = childrenEdges.map(edge => edge.id);

    set({
      collapsedParents: get().collapsedParents.concat(nodeId),
      collapsedNodes: get().collapsedNodes.concat(nodeIds),
      collapsedEdges: get().collapsedEdges.concat(edgeIds),
      graphCollapsed: !!get().collapsedNodes.concat(nodeIds).length,
    });
  },
  collapseGraph: () => {
    const edges = get().edges;
    const tos = edges.map(edge => edge.to);
    const froms = edges.map(edge => edge.from);
    const parentNodesIds = froms.filter(id => !tos.includes(id));
    const secondDegreeNodesIds = edges
      .filter(edge => parentNodesIds.includes(edge.from))
      .map(edge => edge.to);

    const collapsedParents = get()
      .nodes.filter(node => !parentNodesIds.includes(node.id) && node.data?.isParent)
      .map(node => node.id);

    const collapsedNodes = get()
      .nodes.filter(
        node => !parentNodesIds.includes(node.id) && !secondDegreeNodesIds.includes(node.id)
      )
      .map(node => node.id);

    const closestParentToRoot = Math.min(...collapsedParents.map(n => +n));
    const focusNodeId = `g[id*='node-${closestParentToRoot}']`;
    const rootNode = document.querySelector(focusNodeId);

    set({
      collapsedParents,
      collapsedNodes,
      collapsedEdges: get()
        .edges.filter(edge => !parentNodesIds.includes(edge.from))
        .map(edge => edge.id),
      graphCollapsed: true,
    });

    if (rootNode) {
      get().viewPort?.camera?.centerFitElementIntoView(rootNode as HTMLElement, {
        elementExtraMarginForZoom: 300,
      });
    }
  },
  expandGraph: () => {
    set({
      collapsedNodes: [],
      collapsedEdges: [],
      collapsedParents: [],
      graphCollapsed: false,
    });
  },
  focusFirstNode: () => {
    const rootNode = document.querySelector("g[id*='node-1']");
    get().viewPort?.camera?.centerFitElementIntoView(rootNode as HTMLElement, {
      elementExtraMarginForZoom: 100,
    });
  },
  setZoomFactor: zoomFactor => {
    const viewPort = get().viewPort;
    viewPort?.camera?.recenter(viewPort.centerX, viewPort.centerY, zoomFactor);
  },
  zoomIn: () => {
    const viewPort = get().viewPort;
    viewPort?.camera?.recenter(viewPort.centerX, viewPort.centerY, viewPort.zoomFactor + 0.1);
  },
  zoomOut: () => {
    const viewPort = get().viewPort;
    viewPort?.camera?.recenter(viewPort.centerX, viewPort.centerY, viewPort.zoomFactor - 0.1);
  },
  centerView: () => {
    const viewPort = get().viewPort;
    viewPort?.updateContainerSize();

    const canvas = document.querySelector(".jsoncrack-canvas") as HTMLElement | null;
    if (canvas) {
      viewPort?.camera?.centerFitElementIntoView(canvas);
    }
  },
  toggleFullscreen: fullscreen => set({ fullscreen }),
  setViewPort: viewPort => set({ viewPort }),
  updateNodeContent: newContent => {
    const selectedNode = get().selectedNode;
    if (selectedNode) {
      // Update the node's text
      selectedNode.text = newContent;

      // Update the nodes array
      const updatedNodes = get().nodes.map(node =>
        node.id === selectedNode.id ? { ...node, text: newContent } : node
      );

      // Update the JSON input if path exists
      if (selectedNode.path) {
        try {
          // Parse the JSON string into an object
          const updatedJsonObj = JSON.parse(useJson.getState().json);
          // Filter out {Root} and empty segments from the path
          const pathSegments = selectedNode.path
            .split('.')
            .filter(segment => segment !== '{Root}' && segment.length > 0);

          if (pathSegments.length === 0) {
            return;
          }

          let current = updatedJsonObj;
          for (let i = 0; i < pathSegments.length - 1; i++) {
            const key = pathSegments[i];
            if (!current[key] || typeof current[key] !== 'object') {
              current[key] = {};
            }
            current = current[key];
          }

          const lastSegment = pathSegments[pathSegments.length - 1];
          if (current[lastSegment] !== undefined) {
            // Handle renaming of the property
            current[newContent] = current[lastSegment];
            delete current[lastSegment];
          } else {
            // Assign new content if the key does not exist
            current[newContent] = newContent;
          }

          // Stringify and update the JSON in the store - without extra escaping
          const updatedJsonString = JSON.stringify(updatedJsonObj, null, 2);
          
          // Update both JSON store and File store to keep editor in sync
          useJson.getState().setJson(updatedJsonString);
          useFile.getState().setContents({ 
            contents: updatedJsonString, 
            hasChanges: true,
            skipUpdate: false  // Ensure the JSON is properly updated
          });
          
          // Also rebuild the graph based on the updated JSON to ensure visualization is in sync
          get().setGraph(updatedJsonString);
        } catch (e) {
          console.error('Failed to update JSON:', e);
        }
      }

      // Trigger state update (only updating selectedNode to avoid overriding graph changes)
      set({
        selectedNode: { ...selectedNode },
      });
    }
  },
}));

export default useGraph;
