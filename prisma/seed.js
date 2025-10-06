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

  // Helper function to create user with unique email/phone per school
  async function createUser({ name, email, phone, password, role, schoolId }) {
    const existingUser = await prisma.user.findFirst({
      where: {
        schoolId,
        OR: [{ email }, { phone }],
      },
    });

    if (existingUser) {
      console.log(
        `⚠️ Skipping creation of ${role} ${name}: email or phone already exists for this school`
      );
      return existingUser;
    }

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

  // Create Drivers
  const driver1 = await createUser({
    name: "John Driver",
    email: "john.driver@example.com",
    password: "driver123",
    role: "DRIVER",
    schoolId: school.id,
  });

  const driver2 = await createUser({
    name: "Mike Driver",
    email: "mike.driver@example.com",
    password: "driver123",
    role: "DRIVER",
    schoolId: school.id,
  });

  // Create Assistants
  const assistant1 = await createUser({
    name: "Alice Assistant",
    email: "alice.assistant@example.com",
    password: "assistant123",
    role: "ASSISTANT",
    schoolId: school.id,
  });

  const assistant2 = await createUser({
    name: "Bob Assistant",
    email: "bob.assistant@example.com",
    password: "assistant123",
    role: "ASSISTANT",
    schoolId: school.id,
  });

  // Create Parents
  const parent1 = await createUser({
    name: "Jane Parent",
    email: "jane.parent@example.com",
    phone: "0700000001",
    password: "parent123",
    role: "PARENT",
    schoolId: school.id,
  });

  const parent2 = await createUser({
    name: "Paul Parent",
    email: "paul.parent@example.com",
    phone: "0700000002",
    password: "parent123",
    role: "PARENT",
    schoolId: school.id,
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
