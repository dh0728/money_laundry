package com.moneylaundry.api.config;

import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import tools.jackson.core.JsonGenerator;
import tools.jackson.databind.SerializationContext;
import tools.jackson.databind.module.SimpleModule;
import tools.jackson.databind.ser.std.StdSerializer;

/**
 * API 응답의 시각은 app.zone(서울 표준시) 오프셋을 붙인 ISO-8601로 낸다(예: 2026-09-07T13:30:29+09:00). DB는 TIMESTAMPTZ
 * 그대로.
 */
@Configuration
public class JacksonConfig {

  @Bean
  SimpleModule zonedInstantModule(@Value("${app.zone}") String zone) {
    ZoneId zoneId = ZoneId.of(zone);
    SimpleModule module = new SimpleModule("zoned-instant");
    module.addSerializer(
        Instant.class,
        new StdSerializer<>(Instant.class) {
          @Override
          public void serialize(Instant value, JsonGenerator gen, SerializationContext ctxt) {
            gen.writeString(DateTimeFormatter.ISO_OFFSET_DATE_TIME.format(value.atZone(zoneId)));
          }
        });
    return module;
  }
}
