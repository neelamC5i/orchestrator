"use client";

export type NodeStatus = "pending" | "running" | "waiting-approval" | "done" | "error";

export interface PipelineNode {
  id: string;
  label: string;
  icon: string;
  status: NodeStatus;
  metric?: string;
}

const STATUS_STYLES: Record<NodeStatus, { ring: string; bg: string; text: string; dot: string }> = {
  pending:          { ring: "#e2e2ee", bg: "#f8f8fc", text: "#9898b0", dot: "#e2e2ee" },
  running:          { ring: "#d97706", bg: "rgba(217,119,6,.08)", text: "#d97706", dot: "#d97706" },
  "waiting-approval": { ring: "#6c5cf7", bg: "rgba(108,92,247,.08)", text: "#6c5cf7", dot: "#6c5cf7" },
  done:             { ring: "#16a34a", bg: "rgba(22,163,74,.08)", text: "#16a34a", dot: "#16a34a" },
  error:            { ring: "#e63755", bg: "rgba(230,55,85,.08)", text: "#e63755", dot: "#e63755" },
};

function NodeStatusDot({ status }: { status: NodeStatus }) {
  const s = STATUS_STYLES[status];
  if (status === "running") {
    return (
      <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full animate-ping"
        style={{ background: s.dot, opacity: 0.6 }} />
    );
  }
  if (status === "waiting-approval") {
    return (
      <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full border-2 border-white"
        style={{ background: s.dot }} />
    );
  }
  if (status === "done") {
    return (
      <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full border-2 border-white flex items-center justify-center text-white"
        style={{ background: s.dot, fontSize: 7, lineHeight: 1 }}>✓</span>
    );
  }
  return null;
}

function EdgeLine({ from, to, active, done }: { from: NodeStatus; to: NodeStatus; active: boolean; done: boolean }) {
  const color = done ? "#16a34a" : active ? "#d97706" : "#e2e2ee";
  return (
    <div className="flex-1 flex items-center justify-center px-1">
      <div className="relative w-full h-0.5 rounded-full overflow-hidden" style={{ background: "#e2e2ee" }}>
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-all duration-700"
          style={{ background: color, width: done ? "100%" : active ? "60%" : "0%" }}
        />
        {active && (
          <div className="absolute inset-0 rounded-full flow-pulse-anim"
            style={{
              background: `linear-gradient(90deg, transparent, ${color}80, transparent)`,
            }}
          />
        )}
      </div>
    </div>
  );
}

interface PipelineCanvasProps {
  nodes: PipelineNode[];
  onNodeClick?: (node: PipelineNode) => void;
}

export default function PipelineCanvas({ nodes, onNodeClick }: PipelineCanvasProps) {
  const doneCount = nodes.filter(n => n.status === "done").length;
  return (
    <div className="w-full">
      {/* Header strip */}
      <div className="flex items-center justify-between px-5 pt-4 pb-1">
        <div className="text-[10px] font-bold uppercase tracking-widest text-t3">
          Semantic Intelligence Pipeline
        </div>
        <div className="text-[10px] font-semibold text-t3">
          {doneCount}/{nodes.length} layers
        </div>
      </div>
      <div className="w-full overflow-x-auto">
        <div
          className="flex items-start px-4 py-5"
          style={{ minWidth: Math.max(700, nodes.length * 104) }}
        >
          {nodes.map((node, i) => {
            const s = STATUS_STYLES[node.status];
            const isClickable = node.status === "waiting-approval" && onNodeClick;
            const nextNode = nodes[i + 1];
            const edgeActive = node.status === "running" || node.status === "done";
            const edgeDone = node.status === "done" && nextNode?.status !== "pending";
            const glow = node.status === "running" || node.status === "waiting-approval";

            return (
              <div key={node.id} className="flex items-start flex-1">
                {/* Node */}
                <div className="flex flex-col items-center gap-2 flex-shrink-0" style={{ minWidth: 92 }}>
                  <div
                    className={`relative w-12 h-12 rounded-2xl flex items-center justify-center text-xl border-2 transition-all duration-300 ${isClickable ? "cursor-pointer hover:scale-110" : ""} ${node.status === "waiting-approval" ? "animate-pulse" : ""}`}
                    style={{
                      background: s.bg,
                      borderColor: s.ring,
                      boxShadow: glow
                        ? `0 0 0 4px ${s.ring}22, 0 0 14px ${s.ring}66`
                        : node.status !== "pending" ? `0 0 0 3px ${s.ring}22` : "none",
                    }}
                    onClick={() => isClickable && onNodeClick(node)}
                    title={node.status === "waiting-approval" ? "Click to review & approve" : undefined}
                  >
                    {node.icon}
                    <NodeStatusDot status={node.status} />
                  </div>
                  <div className="text-center px-1" style={{ maxWidth: 92 }}>
                    <div className="text-[10.5px] font-semibold text-t1 leading-tight">{node.label}</div>
                    {node.metric && (
                      <div className="text-[9px] font-semibold mt-0.5 leading-tight" style={{ color: s.text }}>
                        {node.metric}
                      </div>
                    )}
                    {node.status === "waiting-approval" && (
                      <div className="text-[9px] font-bold text-accent mt-0.5 animate-pulse">Tap to review</div>
                    )}
                  </div>
                </div>

                {/* Edge to next node */}
                {i < nodes.length - 1 && (
                  <div className="pt-5 flex-1 flex items-center">
                    <EdgeLine
                      from={node.status}
                      to={nodes[i + 1].status}
                      active={edgeActive}
                      done={edgeDone}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
