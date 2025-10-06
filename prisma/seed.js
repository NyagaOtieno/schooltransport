import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

function getRandomCoordinate(base, variance = 0.01) {
  return base + (Math.random() - 0.5) * variance;
}

// Generate a unique bus plate
function randomPlate(existingPlates = new Set()) {
  let plate;
  do {
    const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const numbers = Math.floor(Math.random() * 900 + 100); // 100-999
    plate = `K${letters.charAt(Math.floor(Math.random() * 26))}${letters.charAt(Math.floor(Math.random() * 26))}${numbers}X`;
  } while (existingPlates.has(plate));
  existingPlates.add(plate);
  return plate;
}

async function main() {
  // Cleanup before seeding
  await prisma.manifest.deleteMany();
  await prisma.student.deleteMany();
  await prisma.bus.deleteMany();
  await prisma.user.deleteMany();
  await prisma.school.deleteMany();

  // Schools data with coordinates
  const schoolsData = [
    { name: "Greenwood Academy", logoUrl: "https://example.com/logo.png", address: "123 School Road", phone: "0712345678", lat: -1.2921, lng: 36.8219 },
    { name: "Sunrise School", logoUrl: "https://example.com/logo2.png", address: "456 Sunrise Ave", phone: "0712345679", lat: -1.3000, lng: 36.8300 },
  ];

  const schools = [];
  const busPlates = new Set();

  for (const s of schoolsData) {
    const school = await prisma.school.create({
      data: {
        name: s.name,
        logoUrl: s.logoUrl,
        address: s.address,
        phone: s.phone,
      },
    });
    schools.push({ ...s, id: school.id });
  }

  // Helper to create users for a school
  async function createUsersForSchool(school, role, count) {
    const users = [];
    for (let i = 1; i <= count; i++) {
      const name = `${role} ${i}`;
      const email = `${role.toLowerCase()}${i}_${school.id}@example.com`;
      const phone = `07${Math.floor(Math.random() * 90000000 + 10000000)}`;
      const password = `${role.toLowerCase()}123`;

      const existingUser = await prisma.user.findFirst({
        where: {
          schoolId: school.id,
          OR: [{ email }, { phone }],
        },
      });

      if (existingUser) {
        console.log(`⚠️ Skipping ${role} ${name}, already exists in school ${school.name}`);
        users.push(existingUser);
        continue;
      }

      const user = await prisma.user.create({
        data: {
          name,
          email,
          phone,
          password: await bcrypt.hash(password, 10),
          role,
          schoolId: school.id,
        },
      });
      users.push(user);
    }
    return users;
  }

  // Seed users, buses, students, and manifests per school
  for (const school of schools) {
    const drivers = await createUsersForSchool(school, "DRIVER", 3);
    const assistants = await createUsersForSchool(school, "ASSISTANT", 3);
    const parents = await createUsersForSchool(school, "PARENT", 3);

    // Create multiple buses
    const buses = [];
    for (let i = 1; i <= 2; i++) {
      const bus = await prisma.bus.create({
        data: {
          name: `Bus ${i}`,
          plateNumber: randomPlate(busPlates),
          capacity: 40,
          route: `Route ${i} - City to School`,
          driverId: drivers[i % drivers.length].id,
          assistantId: assistants[i % assistants.length].id,
          schoolId: school.id,
        },
      });
      buses.push(bus);
    }

    // Create students per bus
    for (const bus of buses) {
      for (let i = 1; i <= 5; i++) {
        const parent = parents[i % parents.length];
        const student = await prisma.student.create({
          data: {
            name: `Student ${i} Bus${bus.id}`,
            grade: `Grade ${Math.floor(Math.random() * 6) + 1}`,
            latitude: getRandomCoordinate(school.lat),
            longitude: getRandomCoordinate(school.lng),
            busId: bus.id,
            parentId: parent.id,
            schoolId: school.id,
          },
        });

        // Create manifests for student
        await prisma.manifest.createMany({
          data: [
            {
              studentId: student.id,
              busId: bus.id,
              assistantId: bus.assistantId,
              status: "CHECKED_IN",
              latitude: student.latitude,
              longitude: student.longitude,
            },
            {
              studentId: student.id,
              busId: bus.id,
              assistantId: bus.assistantId,
              status: "CHECKED_OUT",
              latitude: getRandomCoordinate(student.latitude),
              longitude: getRandomCoordinate(student.longitude),
            },
          ],
        });
      }
    }
  }

  console.log("✅ Seeding completed successfully with multiple schools, users, buses, students, and manifests!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
