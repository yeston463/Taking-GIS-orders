import { OrderItem, OrderStatus, ServiceType } from './utils/order-utils.ts';

export type { OrderItem, OrderStatus, ServiceType };

export interface CaseStudy {
  id: string;
  title: string;
  serviceType: ServiceType;
  summary: string;
  background: string;
  solution: string;
  deliverables: string[];
  techTags: string[];
  dataNotice: string;
  coordinates?: [number, number];
}
