import {
  ParkingRequest,
  ParkingSession,
  Reservation,
  Vehicle,
  nextId,
} from "../models/index.js";
import { validateReservation } from "../scheduler/index.js";
import { badRequest, conflict, notFound } from "../utils/errors.js";
import { publish } from "../utils/socket.js";
import { runScheduler } from "./allocationService.js";
import { getRuntimeConfig } from "./configService.js";
import { toReservationView } from "./views.js";

export interface SubmitInput {
  registration: string;
  vehicleType: "bike" | "car" | "suv" | "other";
  expectedDurationMinutes: number;
  urgencyClaim?: "normal" | "priority" | "emergency";
  reservationId?: string;
  preferredAreaCode?: string;
  requiresAccessibleSlot?: boolean;
  specialRequirements?: string;
}

export async function submitRequest(input: SubmitInput) {
  const messages: string[] = [];
  const cfg = await getRuntimeConfig();

  let vehicle = await Vehicle.findOne({ registration: input.registration });
  if (vehicle && vehicle.vehicleType !== input.vehicleType) {
    throw conflict(
      `${input.registration} is registered as "${vehicle.vehicleType}", not "${input.vehicleType}"`,
    );
  }
  if (!vehicle)
    vehicle = await Vehicle.create({
      registration: input.registration,
      vehicleType: input.vehicleType,
    });

  if (
    await ParkingRequest.exists({
      registration: input.registration,
      status: "waiting",
    })
  ) {
    throw conflict(`${input.registration} already has a waiting request`);
  }
  if (
    await ParkingSession.exists({
      registration: input.registration,
      status: "active",
    })
  ) {
    throw conflict(`${input.registration} is already parked`);
  }

  // Urgency is NEVER taken from the form: it comes from the verified vehicle record.
  const urgency = vehicle.priorityCategory;
  if (
    input.urgencyClaim &&
    input.urgencyClaim !== "normal" &&
    input.urgencyClaim !== urgency
  ) {
    messages.push(
      `Claimed urgency "${input.urgencyClaim}" is not verified; the request is treated as "${urgency}". An operator must verify priority status.`,
    );
  }
  const requiresAccessibleSlot = vehicle.needsAccessibleSlot;
  if (input.requiresAccessibleSlot && !requiresAccessibleSlot) {
    messages.push(
      "Accessible-slot requirement is not verified for this vehicle; accessible slots are not reserved for it.",
    );
  }

  let reservation = null;
  let reservationValid = false;
  if (input.reservationId) {
    reservation = await Reservation.findOne({
      reservationId: input.reservationId,
    });
    if (!reservation)
      throw badRequest(`Reservation ${input.reservationId} does not exist`);
    if (reservation.registration !== input.registration)
      throw badRequest("Reservation belongs to a different vehicle");
    const check = validateReservation(
      toReservationView(reservation.toObject()),
      input.registration,
      new Date(),
      cfg.engine,
    );
    reservationValid = check.valid;
    messages.push(
      check.valid
        ? "Reservation verified."
        : `Reservation gives no benefit: ${check.reason}.`,
    );
  }

  let request;
  for (let attempt = 0; !request; attempt++) {
    try {
      request = await ParkingRequest.create({
        requestId: await nextId("REQ"),
        vehicle: vehicle._id,
        registration: input.registration,
        vehicleType: input.vehicleType,
        arrivalTime: new Date(),
        expectedDurationMinutes: input.expectedDurationMinutes,
        activeRegistration: input.registration,
        urgency,
        reservation: reservation?._id ?? null,
        reservationValid,
        preferredAreaCode: input.preferredAreaCode ?? null,
        requiresAccessibleSlot,
        specialRequirements: input.specialRequirements ?? "",
      });
    } catch (e) {
      if ((e as { code?: number }).code !== 11000) throw e;
      // Two possible causes: (a) this vehicle really has a waiting request, or (b) an ID race.
      // Ask the database instead of parsing error text (works on any MongoDB-compatible server).
      if (await ParkingRequest.exists({ activeRegistration: input.registration })) {
        throw conflict(`${input.registration} already has a waiting request`);
      }
      if (attempt >= 8) throw e;
    }
  }
  publish("request:created", { requestId: request.requestId });
  await runScheduler("request");

  const fresh = (await ParkingRequest.findById(request._id)
    .populate("allocation")
    .lean())!;
  const allocated = fresh.status === "allocated";
  messages.unshift(
    allocated
      ? `Allocated slot ${(fresh.allocation as any)?.slotCode}.`
      : "No suitable slot is free right now; the request is waiting in the queue.",
  );
  return { request: fresh, allocated, messages };
}

export async function cancelRequest(id: string) {
  const r = await ParkingRequest.findOneAndUpdate(
    { _id: id, status: "waiting" },
    { $set: { status: "cancelled" }, $unset: { activeRegistration: 1 } },
    { new: true },
  ).lean();
  if (!r) {
    if (!(await ParkingRequest.exists({ _id: id })))
      throw notFound("Request not found");
    throw conflict("Only waiting requests can be cancelled");
  }
  publish("queue:updated", { requestId: r.requestId });
  return r;
}
