package com.moneylaundry.api.analysis;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import java.nio.file.*;
import java.util.*;
import java.util.function.Consumer;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.*;
import software.amazon.awssdk.core.ResponseBytes;
import software.amazon.awssdk.core.sync.RequestBody;
import tools.jackson.databind.ObjectMapper;
class CancellationTransportTests {
 @TempDir Path directory;
 ObjectMapper mapper=new ObjectMapper();UUID cancel=UUID.randomUUID(),request=UUID.randomUUID(),run=UUID.randomUUID();
 String payload(){return mapper.writeValueAsString(Map.of("contract_version",2,"job_id",12,"model_kind","BINARY","request_id",request,"execution_round",1,"run_id",run,"cancel_id",cancel,"reason_code","REPORT_CORRECTED","requested_at","2026-09-17T00:00:00Z"));}
 String base(){return "12/BINARY/"+request+"/rounds/1/";}
 @Test void local_immutable_publication_and_identity_checked_ack() throws Exception {
  var transport=new CancellationTransport(mock(S3Client.class),mapper,"","",directory.toString());String payload=payload();
  transport.publish(cancel,payload);transport.publish(cancel,payload);
  Path file=directory.resolve("analysis-transport/requests/"+base()+"cancel.json");assertThat(Files.readString(file)).isEqualTo(payload);
  try(var paths=Files.walk(directory)){assertThat(paths.filter(p->p.toString().endsWith(".tmp")).count()).isZero();}
  assertThat(transport.acknowledgement(cancel,payload)).isNull();
  var ack=mapper.readTree(payload).deepCopy();((tools.jackson.databind.node.ObjectNode)ack).put("status","STOPPED");
  Path result=directory.resolve("analysis-transport/results/"+base()+"cancel_ack.json");Files.createDirectories(result.getParent());Files.writeString(result,mapper.writeValueAsString(ack));
  assertThat(transport.acknowledgement(cancel,payload)).isEqualTo("STOPPED");
  ((tools.jackson.databind.node.ObjectNode)ack).put("run_id",UUID.randomUUID().toString());Files.writeString(result,mapper.writeValueAsString(ack));
  assertThatThrownBy(()->transport.acknowledgement(cancel,payload)).hasMessage("CANCEL_ACK_IDENTITY_MISMATCH");
  assertThatThrownBy(()->transport.publish(cancel,payload.replace("REPORT_CORRECTED","OTHER_REASON"))).hasMessage("CANCEL_IMMUTABLE_CONFLICT");
 }
 @Test void s3_uses_conditional_immutable_put_and_validates_ack() {
  S3Client client=mock(S3Client.class);var transport=new CancellationTransport(client,mapper,"test-bucket","test-prefix",directory.toString());String payload=payload();
  transport.publish(cancel,payload);
  var capture=org.mockito.ArgumentCaptor.forClass(PutObjectRequest.class);verify(client).putObject(capture.capture(),any(RequestBody.class));
  assertThat(capture.getValue().ifNoneMatch()).isEqualTo("*");assertThat(capture.getValue().key()).isEqualTo("test-prefix/requests/"+base()+"cancel.json");
  var ack=(tools.jackson.databind.node.ObjectNode)mapper.readTree(payload);ack.put("status","ALREADY_FINISHED");
  when(client.getObjectAsBytes(org.mockito.ArgumentMatchers.<Consumer<GetObjectRequest.Builder>>any())).thenReturn(ResponseBytes.fromByteArray(GetObjectResponse.builder().build(),mapper.writeValueAsBytes(ack)));
  assertThat(transport.acknowledgement(cancel,payload)).isEqualTo("ALREADY_FINISHED");
 }

 @Test void existing_scheduler_runs_cancellation_while_analysis_task_waits() throws Exception {
  var scheduler=new AnalysisConfiguration().taskScheduler();scheduler.initialize();
  var entered=new java.util.concurrent.CountDownLatch(1);var release=new java.util.concurrent.CountDownLatch(1);var cancellation=new java.util.concurrent.CountDownLatch(1);
  try {
   scheduler.execute(()->{entered.countDown();try{release.await(5,java.util.concurrent.TimeUnit.SECONDS);}catch(InterruptedException e){Thread.currentThread().interrupt();}});
   assertThat(entered.await(5,java.util.concurrent.TimeUnit.SECONDS)).isTrue();
   scheduler.execute(cancellation::countDown);assertThat(cancellation.await(2,java.util.concurrent.TimeUnit.SECONDS)).isTrue();
  } finally {release.countDown();scheduler.shutdown();}
 }
}
