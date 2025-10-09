import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log("🧹 Cleaning up existing data...");

  await prisma.manifest.deleteMany().catch(() => {});
  await prisma.student.deleteMany().catch(() => {});
  await prisma.bus.deleteMany().catch(() => {});
  await prisma.parent.deleteMany().catch(() => {});
  await prisma.user.deleteMany().catch(() => {});
  await prisma.school.deleteMany().catch(() => {});

  console.log("✅ Cleanup complete.\n");

  // -----------------------------
  // Create School
  // -----------------------------
  console.log("🏫 Creating school...");
  const school = await prisma.school.create({
    data: {
      name: "Greenwood Academy",
      logoUrl: "https://example.com/logo.png",
      address: "123 School Road",
      phone: "0712345678",
    },
  });
  console.log(`✅ School created: ${school.name}\n`);

  // -----------------------------
// Create Admin
// -----------------------------
console.log("\n🧑‍💼 Creating admin user...");
await createUser({
  name: "System Admin",
  email: "admin@schooltrack.com",
  phone: "0700009999",
  password: "admin123",
  role: "ADMIN",
  schoolId: school.id,
});


  // -----------------------------
  // Helper: Create user safely
  // -----------------------------
  async function createUser({ name, email, phone, password, role, schoolId }) {
    const existingUser = await prisma.user.findFirst({
      where: { schoolId, OR: [{ email }, { phone }] },
    });

    if (existingUser) {
      console.log(`⚠️  Skipping ${role} '${name}': already exists`);
      return existingUser;
    }

    const user = await prisma.user.create({
      data: {
        name,
        email,
        phone,
        password: await bcrypt.hash(password, 10),
        role,
        schoolId,
      },
    });
    console.log(`👤 Created ${role}: ${user.name}`);
    return user;
  }

  // -----------------------------
  // Create Drivers and Assistants
  // -----------------------------
  console.log("\n🚌 Creating drivers and assistants...");
  const driverNames = ["John Driver", "Mike Driver", "David Driver", "Chris Driver"];
  const assistantNames = ["Alice Assistant", "Bob Assistant", "Carol Assistant", "Diana Assistant"];

  const drivers = [];
  const assistants = [];

  for (let i = 0; i < driverNames.length; i++) {
    const driver = await createUser({
      name: driverNames[i],
      email: `${driverNames[i].split(" ")[0].toLowerCase()}.driver@example.com`,
      phone: `07110000${i + 1}`,
      password: "driver123",
      role: "DRIVER",
      schoolId: school.id,
    });
    drivers.push(driver);

    const assistant = await createUser({
      name: assistantNames[i],
      email: `${assistantNames[i].split(" ")[0].toLowerCase()}.assistant@example.com`,
      phone: `07220000${i + 1}`,
      password: "assistant123",
      role: "ASSISTANT",
      schoolId: school.id,
    });
    assistants.push(assistant);
  }

  // -----------------------------
  // Create Parents
  // -----------------------------
  console.log("\n👨‍👩‍👧 Creating parents...");
  const parentNames = ["Jane Parent", "Paul Parent", "Mary Parent", "Peter Parent"];
  const dbParents = [];

  for (let i = 0; i < parentNames.length; i++) {
    // Create Parent record first
    const parent = await prisma.parent.create({
      data: {
        name: parentNames[i],
        phone: `070000000${i + 1}`,
      },
    });
    dbParents.push(parent);
    console.log(`✅ Parent created: ${parent.name}`);

    // Optional: create corresponding User account
    await createUser({
      name: parentNames[i],
      email: `${parentNames[i].split(" ")[0].toLowerCase()}.parent@example.com`,
      phone: `070000000${i + 1}`,
      password: "parent123",
      role: "PARENT",
      schoolId: school.id,
    });
  }

  // -----------------------------
  // Create Buses
  // -----------------------------
  console.log("\n🚌 Creating multiple buses...");
  const busData = [
    { name: "Morning Express", plate: "KAA123X", route: "Route A - City to School" },
    { name: "Sunrise Shuttle", plate: "KBB456Y", route: "Route B - Westlands to School" },
    { name: "Evening Cruiser", plate: "KCC789Z", route: "Route C - South B to School" },
    { name: "Highway Comet", plate: "KDD101A", route: "Route D - Embakasi to School" },
  ];

  const buses = [];

  for (let i = 0; i < busData.length; i++) {
    const bus = await prisma.bus.create({
      data: {
        name: busData[i].name,
        plateNumber: busData[i].plate,
        capacity: 40,
        route: busData[i].route,
        driverId: drivers[i].id,
        schoolId: school.id,
      },
    });
    buses.push(bus);
    console.log(`✅ Bus created: ${bus.name} (${bus.plateNumber})`);
  }

  // -----------------------------
  // Assign Assistants
  // -----------------------------
  console.log("\n🔄 Assigning assistants to buses...");
  for (let i = 0; i < buses.length; i++) {
    await prisma.bus.update({
      where: { id: buses[i].id },
      data: { assistantId: assistants[i].id },
    });
    console.log(`✅ Assistant ${assistants[i].name} assigned to ${buses[i].name}`);
  }

  // -----------------------------
  // Create Students (2–3 per parent)
  // -----------------------------
  console.log("\n🎒 Creating students...");
  const studentNames = [
    "Emma Student", "Liam Student", "Sophia Student", "Noah Student",
    "Olivia Student", "Mason Student", "Isabella Student", "Ethan Student",
    "Ava Student", "Lucas Student", "Mia Student", "James Student"
  ];

  const allStudents = [];
  let nameIndex = 0;

  for (const parent of dbParents) {
    const siblingCount = Math.floor(Math.random() * 2) + 2; // 2–3 students per parent
    for (let i = 0; i < siblingCount; i++) {
      const assignedBus = buses[(nameIndex + i) % buses.length];
      const student = await prisma.student.create({
        data: {
          name: studentNames[nameIndex % studentNames.length],
          grade: `Grade ${4 + ((nameIndex + i) % 3)}`,
          latitude: -1.29 + Math.random() * 0.03,
          longitude: 36.82 + Math.random() * 0.03,
          busId: assignedBus.id,
          parentId: parent.id,
          schoolId: school.id,
        },
      });
      allStudents.push(student);
      console.log(`✅ Student ${student.name} assigned to ${assignedBus.name} (Parent: ${parent.name})`);
      nameIndex++;
    }
  }

  // -----------------------------
  // Create Manifests
  // -----------------------------
  console.log("\n📋 Creating manifests...");
  for (const student of allStudents) {
    const bus = buses.find((b) => b.id === student.busId);
    if (!bus) continue;

    await prisma.manifest.create({
      data: {
        studentId: student.id,
        busId: bus.id,
        assistantId: bus.assistantId,
        status: "CHECKED_IN",
        latitude: student.latitude,
        longitude: student.longitude,
      },
    });
    console.log(`🧾 ${student.name} CHECKED_IN on ${bus.name}`);

    if (Math.random() > 0.5) {
      await prisma.manifest.create({
        data: {
          studentId: student.id,
          busId: bus.id,
          assistantId: bus.assistantId,
          status: "CHECKED_OUT",
          latitude: student.latitude + 0.001,
          longitude: student.longitude + 0.001,
        },
      });
      console.log(`📤 ${student.name} CHECKED_OUT from ${bus.name}`);
    }
  }

  console.log("\n✅ Seeding completed successfully!");
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    console.log("🔌 Disconnected from database.");
  });
