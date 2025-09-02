type Face = {
  id: string;
  agentPath: string;
  createdAt: number;
};

const faces = new Map<string, Face>(); // key: faceId
const agentFaces = new Map<string, Set<string>>(); // agentPath -> face ids

export const createFace = (agentPath: string): Face => {
  const id = crypto.randomUUID();
  const f = { id, agentPath, createdAt: Date.now() };
  faces.set(id, f);
  if (!agentFaces.has(agentPath)) agentFaces.set(agentPath, new Set());
  agentFaces.get(agentPath)!.add(id);
  return f;
};

export const getFace = (id: string): Face | undefined => faces.get(id);

export const listFaces = (agentPath: string): Face[] => {
  const ids = agentFaces.get(agentPath);
  if (!ids) return [];
  return Array.from(ids).map((id) => faces.get(id)!).filter(Boolean);
};

