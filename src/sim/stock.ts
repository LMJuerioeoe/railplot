// The simulator's rolling stock: a few kinds of vehicle, sized for the layout's scale.
import { VehicleCfg, VehicleKind } from "../control/types";
import { wagonLength } from "../yards";

export interface StockType { kind: VehicleKind; name: string; /** length in short wagons */ wagons: number; color: string; detectable: boolean }

export const STOCK: StockType[] = [
  { kind: "loco", name: "Locomotive", wagons: 2.7, color: "#2f5f9e", detectable: true },
  { kind: "coach", name: "Coach", wagons: 3.4, color: "#7a2f2a", detectable: false },
  { kind: "wagon", name: "Open wagon", wagons: 1, color: "#6f6a5f", detectable: false },
  { kind: "van", name: "Box van", wagons: 1.05, color: "#8a5a3c", detectable: false },
  { kind: "tank", name: "Tank wagon", wagons: 0.95, color: "#2b2f33", detectable: false },
  { kind: "brake", name: "Brake van", wagons: 1.1, color: "#5c4a3a", detectable: false },
];

/** A new vehicle of a kind, its length for the track system's scale (OO or H0). */
export function newVehicle(kind: VehicleKind, libId: string, id: string, color?: string): VehicleCfg {
  const t = STOCK.find((x) => x.kind === kind) ?? STOCK[2];
  return { id, kind, name: t.name, length: Math.round(wagonLength(libId) * t.wagons), color: color ?? t.color, detectable: t.detectable };
}
