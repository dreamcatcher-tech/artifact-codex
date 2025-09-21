export interface PortRange {
  start: number
  end: number
}

export interface PortAllocation {
  group: string
  ports: number[]
}

export class PortAllocator {
  private readonly ranges: Map<string, PortRange>
  private readonly inUse: Map<string, Set<number>>

  constructor(ranges: Record<string, PortRange>) {
    this.ranges = new Map(Object.entries(ranges))
    this.inUse = new Map()
  }

  allocate(group: string, count = 1): PortAllocation {
    if (count < 1) {
      throw new Error('Port allocation count must be at least 1')
    }
    const range = this.ranges.get(group)
    if (!range) {
      throw new Error(`Unknown port group: ${group}`)
    }
    const inUse = this.ensureSet(group)
    const ports: number[] = []
    for (
      let port = range.start;
      port <= range.end && ports.length < count;
      port += 1
    ) {
      if (!inUse.has(port)) {
        ports.push(port)
        inUse.add(port)
      }
    }
    if (ports.length !== count) {
      for (const port of ports) {
        inUse.delete(port)
      }
      throw new Error(
        `Unable to allocate ${count} port(s) from group '${group}'`,
      )
    }
    return { group, ports }
  }

  release(allocation: PortAllocation): void {
    const inUse = this.inUse.get(allocation.group)
    if (!inUse) {
      return
    }
    for (const port of allocation.ports) {
      inUse.delete(port)
    }
  }

  markInUse(group: string, ports: number[]): void {
    const inUse = this.ensureSet(group)
    for (const port of ports) {
      inUse.add(port)
    }
  }

  private ensureSet(group: string): Set<number> {
    let set = this.inUse.get(group)
    if (!set) {
      set = new Set()
      this.inUse.set(group, set)
    }
    return set
  }
}
