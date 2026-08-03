const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');

const jarPath = path.join(__dirname, '../server/vendor/plantuml.jar');
const code = `@startuml GamingCenterManagement_SystemContext
!theme plain
skinparam backgroundColor #FEFEFE
skinparam componentStyle rectangle

title C4 Level 1 — System Context: Платформа управления игровыми центрами

person "Супер-администратор" as super_admin
person "Администратор центра" as center_admin
person "Пользователь (игрок)" as end_user

rectangle "Gaming Center Management Platform\\n[CRM-ERP Система]" as platform {
    rectangle "Модуль бронирования\\n(Booking Service)" as booking
    rectangle "Модуль аналитики и дашбордов\\n(Analytics Service)" as analytics
    rectangle "Модуль событий и турниров\\n(Event Service)" as events
    rectangle "Модуль управления центрами\\n(Center Management)" as centers
}

cloud "Push-уведомления\\n(Firebase / APNs)" as push
cloud "Платёжный шлюз\\n(Stripe / ЮKassa)" as payments
database "Пользовательское\\nмобильное приложение" as mobile_app

super_admin --> centers : Управление центрами\\nи администраторами
super_admin --> analytics : Настройка дашбордов,\\nпросмотр статистики
center_admin --> booking : Карта бронирования,\\nбронирование за пользователя
center_admin --> centers : Настройка зон,\\nуправление сотрудниками
center_admin --> events : Создание турниров,\\nмаркетинговые кампании
center_admin --> booking : Просмотр активных\\nпользователей и оборудования
end_user --> mobile_app : Бронирование,\\nучастие в событиях
mobile_app --> booking : API бронирования
mobile_app --> events : API событий
platform --> push : Отправка уведомлений\\nо событиях и бронировании
platform --> payments : Обработка платежей\\nза бронирования и турниры

@enduml`;

console.log('Testing C4 PlantUML execution...');
const child = execFile('java', ['-jar', jarPath, '-tsvg', '-pipe', '-charset', 'UTF-8'], {
  maxBuffer: 20 * 1024 * 1024,
  encoding: 'utf8'
}, (err, stdout, stderr) => {
  if (err) console.error('EXEC ERR:', err);
  if (stderr) console.error('STDERR:', stderr);
  console.log('STDOUT length:', stdout ? stdout.length : 0);
  if (stdout && stdout.startsWith('<svg')) {
    console.log('SUCCESS! SVG generated cleanly.');
    fs.writeFileSync(path.join(__dirname, '../server/cache/test_c4.svg'), stdout, 'utf8');
  } else {
    console.error('FAILED STDOUT:', stdout);
  }
});

child.stdin.write(code, 'utf-8');
child.stdin.end();
