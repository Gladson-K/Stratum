import { parseMermaid } from './dsl/mermaid';
import { autoLayout } from './layout';
import type { Design } from './sgm';

export interface Template { id: string; name: string; description: string; mermaid: string }

export const TEMPLATES: Template[] = [
  {
    id: 'url-shortener',
    name: 'URL Shortener',
    description: 'Read-heavy service with cache, primary/replica database, and async click analytics.',
    mermaid: `flowchart LR
    %% @scenario rps=20000 sloP99Ms=120 entry=client
    client([Web / Mobile Client])
    cdn[CDN]
    lb[Load Balancer]
    api[Shortener API]
    subgraph data[Data Tier]
        cache[(Redis Cache)]
        db[(PostgreSQL Primary)]
        replica[(Read Replica)]
    end
    clicks[[Kafka click-events]]
    analytics[Analytics Worker]
    olap[(ClickHouse)]
    client --> cdn --> lb --> api
    api --> cache
    api --> db
    db -.->|replication| replica
    api -.->|click event| clicks
    clicks -.-> analytics -.-> olap
    %% @node api instances=4 concurrency=200 serviceTimeMs=3
    %% @node cache hitRatio=0.95 instances=2
    %% @node db instances=2 concurrency=300
    %% @node clicks instances=3
`,
  },
  {
    id: 'notification-service',
    name: 'Notification Service',
    description: 'Fan-out notifications over push and email with queues and third-party providers. Contains deliberate flaws for the critique demo.',
    mermaid: `flowchart LR
    %% @scenario rps=3000 sloP99Ms=400 entry=producers
    producers([Internal Producers])
    api[Notification API]
    prefs[(Preferences DB)]
    queue[[Notification Queue]]
    router[Channel Router]
    push[Push Worker]
    email[Email Worker]
    apns((APNs / FCM))
    sendgrid((SendGrid))
    producers --> api
    api --> prefs
    api --> queue
    queue -.-> router
    router -.-> push
    router -.-> email
    push --> apns
    email --> sendgrid
    %% @node api instances=2 concurrency=100 serviceTimeMs=6
    %% @node prefs instances=1 concurrency=150 serviceTimeMs=3
    %% @node router instances=2
    %% @node email instances=1 concurrency=20 serviceTimeMs=15
`,
  },
  {
    id: 'ecommerce-checkout',
    name: 'E-commerce Checkout',
    description: 'Gateway, order and payment services, inventory, and order events.',
    mermaid: `flowchart LR
    %% @scenario rps=1500 sloP99Ms=600 entry=shopper
    shopper([Shopper App])
    gw{{API Gateway}}
    orders[Order Service]
    inventory[Inventory Service]
    payments[Payment Service]
    ordersdb[(Orders DB)]
    invdb[(Inventory DB)]
    stripe((Stripe))
    events[[Kafka order-events]]
    email[Email Worker]
    shopper --> gw --> orders
    orders --> inventory
    orders --> payments
    orders --> ordersdb
    orders --> events
    inventory --> invdb
    payments --> stripe
    events -.-> email
    %% @node orders instances=3 concurrency=100 serviceTimeMs=10
    %% @node inventory instances=2 serviceTimeMs=5
    %% @node payments instances=2 serviceTimeMs=8
    %% @node ordersdb instances=1
    %% @node invdb instances=1
    %% @node stripe serviceTimeMs=250
`,
  },
  {
    id: 'chat-app',
    name: 'Real-time Chat',
    description: 'WebSocket gateway, presence in Redis, message fan-out over a stream, and Cassandra storage.',
    mermaid: `flowchart LR
    %% @scenario rps=8000 sloP99Ms=150 entry=client
    client([Chat Client])
    lb[Load Balancer]
    ws[WebSocket Gateway]
    chat[Chat Service]
    presence[(Redis Presence)]
    msgs[[Kafka messages]]
    store[(Cassandra Messages)]
    fanout[Fan-out Worker]
    client --> lb --> ws --> chat
    chat --> presence
    chat --> store
    chat -.-> msgs
    msgs -.-> fanout
    fanout -.-> ws
    %% @node ws instances=6 concurrency=2000 serviceTimeMs=1
    %% @node chat instances=6 concurrency=150 serviceTimeMs=4
    %% @node store kind=database instances=3 concurrency=400 serviceTimeMs=2
    %% @node presence instances=2
`,
  },
];

export function loadTemplate(id: string): Design {
  const t = TEMPLATES.find((x) => x.id === id) ?? TEMPLATES[0];
  const { design } = parseMermaid(t.mermaid);
  design.name = t.name;
  return autoLayout(design);
}
