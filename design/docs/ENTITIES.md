# MCP Patterns — Entities and Relationships

```mermaid
erDiagram
  COMPUTER ||--|{ AGENT : contains
  AGENT ||--|{ FACE : has
  FACE ||--o{ VIEW : presents
  FACE ||--o{ INTERACTION : receives

  COMPUTER {
    string computer_id PK
    string computer_kind FK
    string status "pending, ready, error, done, destroyed"
  }

  AGENT {
    string agent_id PK
    string computer_id FK
    string agent_kind FK
    string status "pending, ready, error, done, destroyed"
  }

  FACE {
    string face_id PK
    string agent_id FK
    string face_kind FK
    string status "pending, ready, error, done, destroyed"
  }

  VIEW {
    string view_id PK
    string face_id FK
    string view_kind
  }

  INTERACTION {
    string interaction_id PK
    string face_id FK
    string status "pending, ready, error, done, destroyed"
  }
```
