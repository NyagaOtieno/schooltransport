// ✅ ESM-compatible Prisma import
import pkg from '@prisma/client';
import bcrypt from 'bcryptjs';

const { PrismaClient } = pkg;
const prisma = new PrismaClient();

// ✅ Define roles
const Role = {
  ADMIN: 'ADMIN',
  DRIVER: 'DRIVER',
  ASSISTANT: 'ASSISTANT',
  PARENT: 'PARENT',
};

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
  // Helper: Create user safely
  // -----------------------------
  async function createUser({ name, email, phone, password, role = Role.PARENT, schoolId = null }) {
    let existingUser = null;

    // Check uniqueness only within the school if schoolId is provided
    if (schoolId) {
      if (email) {
        existingUser = await prisma.user.findUnique({
          where: { email_schoolId: { email, schoolId } },
        });
      }
      if (!existingUser && phone) {
        existingUser = await prisma.user.findUnique({
          where: { phone_schoolId: { phone, schoolId } },
        });
      }
    } else {
      // No schoolId: check global uniqueness
      if (email) existingUser = await prisma.user.findUnique({ where: { email } });
      if (!existingUser && phone) existingUser = await prisma.user.findUnique({ where: { phone } });
    }

    if (existingUser) return existingUser;

    return await prisma.user.create({
      data: {
        name,
        email,
        phone,
        password: await bcrypt.hash(password, 10),
        role,
        schoolId,
      },
    });
  }

  // -----------------------------
  // Create Admin
  // -----------------------------
  console.log("🧑‍💼 Creating admin user...");
  await createUser({
    name: "System Admin",
    email: "admin@schooltrack.com",
    phone: "0700009999",
    password: "admin123",
    role: Role.ADMIN,
    schoolId: school.id,
  });

  // -----------------------------
  // Create Drivers and Assistants
  // -----------------------------
  console.log("🚌 Creating drivers and assistants...");
  const driverNames = ["John Driver", "Mike Driver", "David Driver", "Chris Driver"];
  const assistantNames = ["Alice Assistant", "Bob Assistant", "Carol Assistant", "Diana Assistant"];

  const drivers = [];
  const assistants = [];

  for (let i = 0; i < driverNames.length; i++) {
    drivers.push(await createUser({
      name: driverNames[i],
      email: `${driverNames[i].split(" ")[0].toLowerCase()}.driver@example.com`,
      phone: `07110000${i + 1}`,
      password: "driver123",
      role: Role.DRIVER,
      schoolId: school.id,
    }));

    assistants.push(await createUser({
      name: assistantNames[i],
      email: `${assistantNames[i].split(" ")[0].toLowerCase()}.assistant@example.com`,
      phone: `07220000${i + 1}`,
      password: "assistant123",
      role: Role.ASSISTANT,
      schoolId: school.id,
    }));
  }

  // -----------------------------
  // Create Parents + Notifications
  // -----------------------------
  console.log("👨‍👩‍👧 Creating parents and notifications...");
  const parentNames = ["Jane Parent", "Paul Parent", "Mary Parent", "Peter Parent"];
  const dbParents = [];

  for (let i = 0; i < parentNames.length; i++) {
    const parentEmail = `${parentNames[i].split(" ")[0].toLowerCase()}.parent@example.com`;
    const parentPhone = `070000000${i + 1}`;

    // Create parent user first
    const parentUser = await createUser({
      name: parentNames[i],
      email: parentEmail,
      phone: parentPhone,
      password: "parent123",
      role: Role.PARENT,
      schoolId: school.id,
    });

    if (!parentUser || !parentUser.id) {
      throw new Error(`Failed to create parent user for ${parentNames[i]}`);
    }

    // Create Parent record linking to user
    const parent = await prisma.parent.create({
      data: {
        userId: parentUser.id,
      },
    });

    // Random notifications
    for (let n = 0; n < Math.floor(Math.random() * 2) + 1; n++) {
      await prisma.notification.create({
        data: {
          parentId: parent.id,
          title: `Notice ${n + 1}`,
          message: `This is a message for ${parentUser.name}.`,
          type: "info",
        },
      });
    }

    dbParents.push(parent);
    console.log(`✅ Parent created: ${parentUser.name} with notifications`);
  }

  // -----------------------------
  // Create Buses
  // -----------------------------
  console.log("🚌 Creating buses...");
  const busData = [
    { name: "Morning Express", plate: "KAA123X", route: "Route A - City to School" },
    { name: "Sunrise Shuttle", plate: "KBB456Y", route: "Route B - Westlands to School" },
    { name: "Evening Cruiser", plate: "KCC789Z", route: "Route C - South B to School" },
    { name: "Highway Comet", plate: "KDD101A", route: "Route D - Embakasi to School" },
  ];

  const buses = [];
  for (let i = 0; i < busData.length; i++) {
    buses.push(await prisma.bus.create({
      data: {
        name: busData[i].name,
        plateNumber: busData[i].plate,
        capacity: 40,
        route: busData[i].route,
        driverId: drivers[i].id,
        assistantId: assistants[i].id,
        schoolId: school.id,
      },
    }));
  }

  // -----------------------------
  // Create Students and link to parent
  // -----------------------------
  console.log("🎒 Creating students...");
  const studentNames = [
    "Emma Student","Liam Student","Sophia Student","Noah Student",
    "Olivia Student","Mason Student","Isabella Student","Ethan Student",
    "Ava Student","Lucas Student","Mia Student","James Student"
  ];

  const allStudents = [];
  let nameIndex = 0;

  for (const parent of dbParents) {
    const siblings = Math.floor(Math.random() * 2) + 1; // 1-2 students per parent
    for (let i = 0; i < siblings; i++) {
      const studentName = studentNames[nameIndex % studentNames.length];

      // Assign random bus
      const assignedBus = buses[Math.floor(Math.random() * buses.length)];

      const student = await prisma.student.create({
        data: {
          name: studentName,
          grade: `Grade ${4 + Math.floor(Math.random() * 3)}`,
          latitude: -1.29 + Math.random() * 0.03,
          longitude: 36.82 + Math.random() * 0.03,
          busId: assignedBus.id,
          parentId: parent.id,
          schoolId: school.id,
        },
      });

      allStudents.push(student);
      nameIndex++;
      console.log(`✅ Student ${student.name} linked to Parent ID ${parent.id} and Bus ${assignedBus.name}`);
    }
  }

  // -----------------------------
  // Create random manifests
  // -----------------------------
  console.log("📋 Creating manifests...");
  for (const student of allStudents) {
    const bus = buses.find(b => b.id === student.busId);
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
    }
  }

  console.log("\n✅ Seeding completed successfully!");
}

main()
  .catch(e => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    console.log("🔌 Disconnected from database.");
  });
