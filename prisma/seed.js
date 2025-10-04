import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  // Cleanup before seeding
  await prisma.manifest.deleteMany();
  await prisma.student.deleteMany();
  await prisma.bus.deleteMany();
  await prisma.user.deleteMany();
  await prisma.school.deleteMany();

  // Create School
  const school = await prisma.school.create({
    data: {
      name: "Greenwood Academy",
      logoUrl: "https://example.com/logo.png",
      address: "123 School Road",
      phone: "0712345678",
    },
  });

  // Create Drivers
  const driver1 = await prisma.user.create({
    data: {
      name: "John Driver",
      email: "john.driver@example.com",
      password: await bcrypt.hash("driver123", 10),
      role: "DRIVER",
      schoolId: school.id,
    },
  });

  const driver2 = await prisma.user.create({
    data: {
      name: "Mike Driver",
      email: "mike.driver@example.com",
      password: await bcrypt.hash("driver123", 10),
      role: "DRIVER",
      schoolId: school.id,
    },
  });

  // Create Assistants
  const assistant1 = await prisma.user.create({
    data: {
      name: "Alice Assistant",
      email: "alice.assistant@example.com",
      password: await bcrypt.hash("assistant123", 10),
      role: "ASSISTANT",
      schoolId: school.id,
    },
  });

  const assistant2 = await prisma.user.create({
    data: {
      name: "Bob Assistant",
      email: "bob.assistant@example.com",
      password: await bcrypt.hash("assistant123", 10),
      role: "ASSISTANT",
      schoolId: school.id,
    },
  });

  // Create Parents (as Users with role = PARENT)
  const parent1 = await prisma.user.create({
    data: {
      name: "Jane Parent",
      email: "jane.parent@example.com",
      phone: "0700000001",
      password: await bcrypt.hash("parent123", 10),
      role: "PARENT",
      schoolId: school.id,
    },
  });

  const parent2 = await prisma.user.create({
    data: {
      name: "Paul Parent",
      email: "paul.parent@example.com",
      phone: "0700000002",
      password: await bcrypt.hash("parent123", 10),
      role: "PARENT",
      schoolId: school.id,
    },
  });

  // Create Bus
  const bus = await prisma.bus.create({
    data: {
      name: "Morning Express",
      plateNumber: "KAA123X",
      capacity: 40,
      route: "Route A - City to School",
      driverId: driver1.id,
      assistantId: assistant1.id,
      schoolId: school.id,
    },
  });

  // Create Students
  const student1 = await prisma.student.create({
    data: {
      name: "Emma Student",
      grade: "Grade 5",
      latitude: -1.2921,
      longitude: 36.8219,
      busId: bus.id,
      parentId: parent1.id,
      schoolId: school.id,
    },
  });

  const student2 = await prisma.student.create({
    data: {
      name: "Liam Student",
      grade: "Grade 6",
      latitude: -1.3000,
      longitude: 36.8200,
      busId: bus.id,
      parentId: parent1.id,
      schoolId: school.id,
    },
  });

  const student3 = await prisma.student.create({
    data: {
      name: "Sophia Student",
      grade: "Grade 4",
      latitude: -1.3100,
      longitude: 36.8300,
      busId: bus.id,
      parentId: parent2.id,
      schoolId: school.id,
    },
  });

  // Create Manifests
  await prisma.manifest.createMany({
    data: [
      {
        studentId: student1.id,
        busId: bus.id,
        assistantId: assistant1.id,
        status: "CHECKED_IN",
        latitude: -1.2921,
        longitude: 36.8219,
      },
      {
        studentId: student1.id,
        busId: bus.id,
        assistantId: assistant1.id,
        status: "CHECKED_OUT",
        latitude: -1.2922,
        longitude: 36.8220,
      },
      {
        studentId: student2.id,
        busId: bus.id,
        assistantId: assistant1.id,
        status: "CHECKED_IN",
        latitude: -1.3000,
        longitude: 36.8200,
      },
      {
        studentId: student3.id,
        busId: bus.id,
        assistantId: assistant1.id,
        status: "CHECKED_IN",
        latitude: -1.3100,
        longitude: 36.8300,
      },
    ],
  });

  console.log("✅ Seeding completed successfully with school, users, bus, students, and manifests!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
